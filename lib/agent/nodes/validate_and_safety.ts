// lib/agent/nodes/validate_and_safety.ts
// replaces sql_validate + safety_check as two separate nodes
import { validateAndCorrectSQL } from '../../sql-validator';
import type { AgentStateType } from '../state';
import type { SchemaTable } from '../../types';
import { logQueryStep } from '../../query-logger';

const MUTATION_PATTERNS = /\b(DELETE|UPDATE|DROP|ALTER|INSERT)\b/i;

function standardizeIdentifiers(
  sql: string,
  dbDialect: string,
  schemaInfo: SchemaTable[] | null
): { correctedSql: string; corrections: string[]; unmatchedIdentifiers: string[] } {
  if (!schemaInfo) {
    return { correctedSql: sql, corrections: [], unmatchedIdentifiers: [] };
  }
  return validateAndCorrectSQL(sql, schemaInfo, dbDialect);
}

export async function validateAndSafetyNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const sql = state.generatedSQL;
  if (!sql) return {};

  // --- Part 1: Table/Column Existence Check (from sql_validate) ---
  const validation = validateTablesExistInSchema(sql, state.schemaInfo);

  if (!validation.valid) {
    // Route straight to responder — no retry, LLM already had its chance
    const availableTables = state.schemaInfo
      ?.map(t => `- ${t.name} (${t.columns.map(c => c.name).join(', ')})`)
      .join('\n') ?? '';

    logQueryStep({
      type: 'validation',
      sql: `-- Validation Failed: Unknown tables: ${validation.unknownTables.join(', ')}`,
      success: false,
      error: `Unknown tables: ${validation.unknownTables.join(', ')}`,
    });

    return {
      generatedSQL: "",
      error: `Unknown tables: ${validation.unknownTables.join(', ')}`,
      finalResponse: {
        type: "error",
        message: `The query references tables that don't exist in your database: ${validation.unknownTables.join(', ')}.\n\nAvailable tables:\n${availableTables}`
      }
    };
  }

  // --- Part 2: Identifier Standardization (from sql_validate) ---
  const result = standardizeIdentifiers(sql, state.dbDialect, state.schemaInfo);
  const standardizedSQL = result.correctedSql;

  // --- Part 3: Safety Check (from safety_check) ---
  const isMutation = MUTATION_PATTERNS.test(standardizedSQL);
  const mutationMatch = standardizedSQL.match(MUTATION_PATTERNS);
  const mutationType = mutationMatch ? mutationMatch[1].toUpperCase() : '';

  const update: Partial<AgentStateType> = {
    generatedSQL: standardizedSQL,
    isMutation,
    mutationType,
    identifierCorrections: result.corrections,
    unmatchedIdentifiers: result.unmatchedIdentifiers,
  };

  logQueryStep({
    type: 'validation',
    sql: `-- Validation Check: Standardizing identifiers & safety check\n-- Corrected SQL Casing/Quotes: ${standardizedSQL}${result.corrections.length > 0 ? `\n-- Corrections applied: ${result.corrections.join(', ')}` : ''}`,
    success: true,
  });

  if (state.finalResponse) {
    update.finalResponse = {
      ...state.finalResponse,
      sql: standardizedSQL,
      identifierCorrections: result.corrections,
      unmatchedIdentifiers: result.unmatchedIdentifiers,
      isMutation,
      mutationType,
      pendingApproval: isMutation ? true : undefined,
    };
  }

  return update;
}

function validateTablesExistInSchema(
  sql: string,
  schemaInfo: SchemaTable[] | null
): { valid: boolean; unknownTables: string[] } {
  if (!schemaInfo) return { valid: true, unknownTables: [] };

  const knownTables = schemaInfo.map(t => t.name.toLowerCase());

  // Extract table names from FROM, JOIN, INTO, UPDATE clauses
  const tablePattern = /(?:FROM|JOIN|INTO|UPDATE)\s+[`"']?(\w+)[`"']?/gi;
  const matches = [...sql.matchAll(tablePattern)];
  const usedTables = matches.map(m => m[1].toLowerCase());

  // Exclude CTE names — they're defined in the same query
  const ctePattern = /WITH\s+[`"']?(\w+)[`"']?\s+AS/gi;
  const cteMatches = [...sql.matchAll(ctePattern)];
  const cteNames = cteMatches.map(m => m[1].toLowerCase());

  const unknownTables = usedTables.filter(
    t => !knownTables.includes(t) && !cteNames.includes(t) && t !== 'dual'
  );

  return { valid: unknownTables.length === 0, unknownTables };
}
