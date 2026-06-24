import type { BaseMessage } from '@langchain/core/messages';
import type { SchemaTable } from '../types';
import { getOrCreatePool, executeQuery } from '../database';
import { getConnection } from '../app-state';
import { quotePgTable, quotePgColumn } from '../pg-identifiers';

export interface TargetIdentifiers {
  table: string;
  conditions: Record<string, string | number>;
}

function quoteTable(table: string, dialect: string): string {
  return dialect === 'postgresql' ? quotePgTable(table) : table;
}

function quoteColumn(column: string, dialect: string): string {
  return dialect === 'postgresql' ? quotePgColumn(column) : column;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatSqlValue(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return `'${escapeSqlString(value)}'`;
}

function getMessageType(msg: BaseMessage): string {
  if (typeof msg._getType === 'function') return msg._getType();
  return (msg as { type?: string }).type || '';
}

function getMessageContent(msg: BaseMessage): string {
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : 'text' in part ? String(part.text) : ''))
      .join('\n');
  }
  return String(content);
}

export function buildConversationContext(
  userPrompt: string,
  messages: BaseMessage[],
  maxMessages = 12,
): string {
  const history = messages
    .slice(-maxMessages)
    .map((msg) => {
      const role = getMessageType(msg) === 'human' ? 'user' : 'assistant';
      return `${role}: ${getMessageContent(msg)}`;
    })
    .join('\n');

  return `${history}\nuser: ${userPrompt}`.trim();
}

export function inferTargetTable(context: string, schemaInfo: SchemaTable[] | null): string | null {
  if (!schemaInfo?.length) return null;

  const lowerContext = context.toLowerCase();
  const mentioned = schemaInfo.filter((table) =>
    lowerContext.includes(table.name.toLowerCase()),
  );
  if (mentioned.length === 1) return mentioned[0].name;
  if (mentioned.length > 1) return mentioned[0].name;

  if (/\bemployee(s)?\b/i.test(context)) {
    const employees = schemaInfo.find((table) => table.name.toLowerCase() === 'employees');
    if (employees) return employees.name;
  }

  const nameTables = schemaInfo.filter((table) => {
    const columns = table.columns.map((col) => col.name.toLowerCase());
    return columns.includes('first_name') && columns.includes('last_name');
  });
  if (nameTables.length === 1) return nameTables[0].name;

  return null;
}

function extractEmail(context: string): string | null {
  const match = context.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function extractId(context: string): number | null {
  const patterns = [
    /\bid\s*(?:is|=|:)?\s*(\d+)\b/i,
    /\bemployee\s+id\s*(\d+)\b/i,
    /\brow\s+(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function isLikelyPersonName(value: string): boolean {
  const stopWords = new Set([
    'all', 'any', 'each', 'every', 'name', 'names', 'employee', 'employees',
    'user', 'users', 'row', 'rows', 'record', 'records', 'this', 'that', 'the',
    'with', 'without', 'from', 'into', 'to', 'for', 'and', 'or', 'now', 'do',
  ]);
  return /^[A-Z][a-z]+$/.test(value) && !stopWords.has(value.toLowerCase());
}

function extractFirstAndLastName(context: string): { firstName: string; lastName: string } | null {
  let collectedFirst: string | null = null;
  let collectedLast: string | null = null;

  const firstMentions = [
    ...context.matchAll(/first[_\s-]*name\s*(?:is|=|:)?\s*['"]?([A-Za-z]+)['"]?/gi),
    ...context.matchAll(/\bfirst\s+name\s+is\s+['"]?([A-Za-z]+)['"]?/gi),
  ];
  const lastMentions = [
    ...context.matchAll(/last[_\s-]*name\s*(?:is|=|:)?\s*['"]?([A-Za-z]+)['"]?/gi),
    ...context.matchAll(/\blast\s+name\s+is\s+['"]?([A-Za-z]+)['"]?/gi),
  ];

  for (const match of firstMentions) {
    if (match[1].length > 1) {
      collectedFirst = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
  }
  for (const match of lastMentions) {
    if (match[1].length > 1) {
      collectedLast = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
  }
  if (collectedFirst && collectedLast) {
    return { firstName: collectedFirst, lastName: collectedLast };
  }

  const explicitPatterns = [
    /first[_\s-]*name\s*(?:is|=|:)?\s*['"]?([A-Za-z]+)['"]?[\s,]+(?:and\s+)?last[_\s-]*name\s*(?:is|=|:)?\s*['"]?([A-Za-z]+)['"]?/i,
    /last[_\s-]*name\s*(?:is|=|:)?\s*['"]?([A-Za-z]+)['"]?[\s,]+(?:and\s+)?first[_\s-]*name\s*(?:is|=|:)?\s*['"]?([A-Za-z]+)['"]?/i,
    /first[_\s-]*name\s+['"]?([A-Za-z]+)['"]?\s+and\s+last[_\s-]*name\s+['"]?([A-Za-z]+)['"]?/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = context.match(pattern);
    if (!match) continue;
    const firstName = pattern.source.startsWith('last') ? match[2] : match[1];
    const lastName = pattern.source.startsWith('last') ? match[1] : match[2];
    if (firstName.length > 1 && lastName.length > 1) {
      return {
        firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
        lastName: lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase(),
      };
    }
  }

  const fullNamePatterns = [
    /\b(?:update|change|modify|rename|delete|remove)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/,
    /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+with\s+(?:name|to)\b/i,
    /\bemployee\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/i,
    /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+to\s+[A-Z][a-z]+\b/,
  ];

  for (const pattern of fullNamePatterns) {
    const match = context.match(pattern);
    if (match && isLikelyPersonName(match[1]) && isLikelyPersonName(match[2])) {
      return { firstName: match[1], lastName: match[2] };
    }
  }

  const rowMatch = context.match(
    /\b([A-Z][a-z]+)\t([A-Z][a-z]+)\b.*@|\bfirst_name\b[^\n]*\b([A-Za-z]+)\b[^\n]*\blast_name\b[^\n]*\b([A-Za-z]+)\b/i,
  );
  if (rowMatch) {
    if (rowMatch[3] && rowMatch[4] && isLikelyPersonName(rowMatch[3]) && isLikelyPersonName(rowMatch[4])) {
      return { firstName: rowMatch[3], lastName: rowMatch[4] };
    }
    if (isLikelyPersonName(rowMatch[1]) && isLikelyPersonName(rowMatch[2])) {
      return { firstName: rowMatch[1], lastName: rowMatch[2] };
    }
  }

  const resultRowMatch = context.match(/\b\d+\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
  if (
    resultRowMatch
    && isLikelyPersonName(resultRowMatch[1])
    && isLikelyPersonName(resultRowMatch[2])
  ) {
    return { firstName: resultRowMatch[1], lastName: resultRowMatch[2] };
  }

  return null;
}

export function extractTargetIdentifiers(
  context: string,
  schemaInfo: SchemaTable[] | null,
): TargetIdentifiers | null {
  const table = inferTargetTable(context, schemaInfo);
  if (!table) return null;

  const tableSchema = schemaInfo?.find((entry) => entry.name === table);
  if (!tableSchema) return null;

  const columnNames = new Set(tableSchema.columns.map((col) => col.name.toLowerCase()));
  const conditions: Record<string, string | number> = {};

  const id = extractId(context);
  if (id !== null && columnNames.has('id')) {
    conditions.id = id;
    return { table, conditions };
  }

  const email = extractEmail(context);
  if (email && columnNames.has('email')) {
    conditions.email = email;
    return { table, conditions };
  }

  const names = extractFirstAndLastName(context);
  if (names && columnNames.has('first_name') && columnNames.has('last_name')) {
    conditions.first_name = names.firstName;
    conditions.last_name = names.lastName;
    return { table, conditions };
  }

  return Object.keys(conditions).length > 0 ? { table, conditions } : null;
}

function buildCountSql(
  target: TargetIdentifiers,
  dialect: string,
): string {
  const tableRef = quoteTable(target.table, dialect);
  const whereClause = Object.entries(target.conditions)
    .map(([column, value]) => {
      const columnRef = quoteColumn(column, dialect);
      return `${columnRef} = ${formatSqlValue(value)}`;
    })
    .join(' AND ');

  return `SELECT COUNT(*) AS count FROM ${tableRef} WHERE ${whereClause}`;
}

export async function verifyUniqueTarget(
  target: TargetIdentifiers,
  dialect: string,
): Promise<{ unique: boolean; count: number } | null> {
  try {
    const connection = await getConnection();
    if (!connection) return null;

    const { id: _id, ...poolConfig } = connection;
    const pool = await getOrCreatePool(poolConfig);
    const sql = buildCountSql(target, dialect);
    const result = await executeQuery(pool, sql);
    const count = Number(result.rows[0]?.count ?? result.rows[0]?.COUNT ?? -1);
    if (Number.isNaN(count) || count < 0) return null;
    return { unique: count === 1, count };
  } catch (error) {
    console.error('[Mutation Target Identification] Count query failed:', error);
    return null;
  }
}

export function identifiersFromExecutionResult(
  executionResult: AgentStateExecutionResult | null | undefined,
  schemaInfo: SchemaTable[] | null,
  tableHint?: string | null,
): TargetIdentifiers | null {
  if (!executionResult || executionResult.rowCount !== 1 || !executionResult.rows[0]) {
    return null;
  }

  const row = executionResult.rows[0];
  const table =
    tableHint
    ?? schemaInfo?.find((entry) => {
      const columnNames = new Set(entry.columns.map((col) => col.name.toLowerCase()));
      return Object.keys(row).every((key) => columnNames.has(key.toLowerCase()));
    })?.name
    ?? null;

  if (!table) return null;

  const conditions: Record<string, string | number> = {};
  if (row.id !== undefined && row.id !== null) {
    conditions.id = Number(row.id);
    return { table, conditions };
  }
  if (typeof row.email === 'string') {
    conditions.email = row.email;
    return { table, conditions };
  }
  if (typeof row.first_name === 'string' && typeof row.last_name === 'string') {
    conditions.first_name = row.first_name;
    conditions.last_name = row.last_name;
    return { table, conditions };
  }

  return null;
}

interface AgentStateExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}
