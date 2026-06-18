/**
 * sql-validator.ts
 *
 * Post-generation SQL validator that:
 * 1. Extracts bare (unquoted) identifiers from AI-generated SQL.
 * 2. Matches them case-insensitively against the real schema metadata.
 * 3. Auto-corrects casing mismatches in the SQL string.
 * 4. For PostgreSQL, ensures every matched table/column is wrapped in double-quotes.
 *
 * This is the safety net that catches the class of errors like:
 *   - "column does not exist" (AI lowercased a camelCase column)
 *   - "relation does not exist" (AI lowercased a PascalCase table)
 */

import type { SchemaTable } from './types';
import { quotePgIdentifier } from './pg-identifiers';

export interface ValidationResult {
  /** The corrected SQL (may be identical to input if no issues found). */
  correctedSql: string;
  /** Human-readable descriptions of each auto-correction applied. */
  corrections: string[];
  /** Identifiers found in SQL that could not be matched to the schema. */
  unmatchedIdentifiers: string[];
}

/**
 * Build fast lookup maps from schema tables.
 * Keys are lowercase so we can do case-insensitive matching.
 */
function buildSchemaMaps(tables: SchemaTable[]): {
  tableMap: Map<string, string>; // lowercase → exact name
  columnMap: Map<string, string>; // lowercase → exact name (across all tables)
  columnsByTable: Map<string, Map<string, string>>; // table lowercase → (col lowercase → exact col name)
} {
  const tableMap = new Map<string, string>();
  const columnMap = new Map<string, string>();
  const columnsByTable = new Map<string, Map<string, string>>();

  for (const table of tables) {
    tableMap.set(table.name.toLowerCase(), table.name);
    const colMap = new Map<string, string>();
    for (const col of table.columns) {
      columnMap.set(col.name.toLowerCase(), col.name);
      colMap.set(col.name.toLowerCase(), col.name);
    }
    columnsByTable.set(table.name.toLowerCase(), colMap);
  }

  return { tableMap, columnMap, columnsByTable };
}

/**
 * Validate and auto-correct identifier casing in a generated SQL string.
 *
 * Strategy:
 * - Tokenise the SQL into quoted regions (already safe) and unquoted regions.
 * - Within unquoted regions, find word tokens that match a known table/column.
 * - Replace with the exact-cased version from schema (quoted for PG).
 */
export function validateAndCorrectSQL(
  sql: string,
  tables: SchemaTable[],
  dbType: string
): ValidationResult {
  if (tables.length === 0 || dbType === 'sqlite') {
    // SQLite is case-insensitive natively — no correction needed.
    return { correctedSql: sql, corrections: [], unmatchedIdentifiers: [] };
  }

  const isPg = dbType === 'postgresql';
  const { tableMap, columnMap } = buildSchemaMaps(tables);

  const corrections: string[] = [];
  const unmatchedSet = new Set<string>();

  /**
   * Walk the SQL string token by token, leaving already-quoted identifiers
   * untouched and correcting/quoting bare identifiers that match schema names.
   *
   * Tokenisation rules:
   *   "..." → double-quoted identifier (already safe, preserve as-is)
   *   `...` → backtick-quoted (MySQL-style, preserve as-is)
   *   '...' → string literal (preserve as-is)
   *   $n    → positional parameter (preserve as-is)
   *   word  → potential identifier to check against schema
   */
  let corrected = '';
  let i = 0;

  // SQL keywords that must never be rewritten as identifiers
  const SQL_KEYWORDS = new Set([
    'select','from','where','join','on','and','or','not','in','is','null',
    'true','false','as','order','by','group','having','limit','offset',
    'insert','into','values','update','set','delete','create','alter','drop',
    'table','column','index','unique','primary','key','foreign','references',
    'inner','left','right','full','outer','cross','natural','using',
    'with','recursive','union','all','except','intersect','exists','between',
    'like','ilike','similar','case','when','then','else','end','cast','coalesce',
    'nullif','extract','date','time','timestamp','interval','returning',
    'distinct','count','sum','avg','min','max','asc','desc','nulls','first','last',
    'over','partition','rows','range','unbounded','preceding','following','current',
    'row','filter','within','within','int','integer','text','varchar','boolean',
    'numeric','decimal','float','double','precision','char','serial','bigserial',
    'smallint','bigint','real','json','jsonb','uuid','bytea','money','bit',
    'do','begin','commit','rollback','savepoint','language','plpgsql',
    'perform','raise','notice','exception','return','returns','function',
    'procedure','trigger','view','materialized','refresh','concurrently',
    'explain','analyze','verbose','buffers','format','public','schema',
    'default','constraint','check','deferrable','initially','deferred',
    'immediate','no','action','restrict','cascade','set','match','simple',
    'full','partial','always','generated','identity','sequence','owned',
    'nextval','currval','setval','now','current_timestamp','current_date',
    'current_time','localtime','localtimestamp','at','zone','epoch','year',
    'month','day','hour','minute','second','microseconds','milliseconds',
  ]);

  while (i < sql.length) {
    const ch = sql[i];

    // ── Double-quoted identifier → already quoted, pass through ──────────────
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; } // escaped quote
          j++;
          break;
        }
        j++;
      }
      corrected += sql.slice(i, j);
      i = j;
      continue;
    }

    // ── Single-quoted string literal → pass through ───────────────────────────
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      corrected += sql.slice(i, j);
      i = j;
      continue;
    }

    // ── Backtick-quoted identifier (MySQL) → pass through ────────────────────
    if (ch === '`') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '`') j++;
      corrected += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // ── $n positional parameter → pass through ───────────────────────────────
    if (ch === '$' && /\d/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) j++;
      corrected += sql.slice(i, j);
      i = j;
      continue;
    }

    // ── Word token → potential identifier ────────────────────────────────────
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[\w]/.test(sql[j])) j++;
      const token = sql.slice(i, j);
      const lower = token.toLowerCase();

      if (!SQL_KEYWORDS.has(lower)) {
        // Check if this is a known table or column name (case-insensitive)
        const exactTable = tableMap.get(lower);
        const exactColumn = columnMap.get(lower);
        const exactName = exactTable ?? exactColumn;

        if (exactName !== undefined && exactName !== token) {
          // Casing mismatch — auto-correct
          const quoted = isPg ? quotePgIdentifier(exactName) : exactName;
          corrections.push(`"${token}" → ${quoted}`);
          corrected += quoted;
          i = j;
          continue;
        }

        if (exactName !== undefined && isPg && exactName === token) {
          // Correct casing but not yet quoted for PG — wrap it
          corrected += quotePgIdentifier(exactName);
          i = j;
          continue;
        }

        // Token not in schema — track as unmatched (but don't fail)
        if (exactName === undefined && token.length > 1) {
          unmatchedSet.add(token);
        }
      }

      corrected += token;
      i = j;
      continue;
    }

    // ── Everything else → pass through ───────────────────────────────────────
    corrected += ch;
    i++;
  }

  return {
    correctedSql: corrected,
    corrections,
    unmatchedIdentifiers: [...unmatchedSet],
  };
}
