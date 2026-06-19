import type { QueryType } from './types';

/**
 * Classify a SQL statement into a coarse `QueryType` by its leading verb.
 * Used when enqueueing a history record so the History tab can group/filter.
 */
export function classifyQuery(sql: string): QueryType {
  const trimmed = sql.trim();
  // Match the first SQL keyword, ignoring leading whitespace/comments.
  const match = trimmed.match(/^\s*(?:--[^\n]*\n|\s)*([A-Za-z]+)/);
  const verb = (match?.[1] ?? '').toUpperCase();
  switch (verb) {
    case 'SELECT':
      return 'select';
    case 'INSERT':
    case 'REPLACE':
    case 'MERGE':
    case 'UPSERT':
      return 'insert';
    case 'UPDATE':
      return 'update';
    case 'DELETE':
    case 'TRUNCATE':
      return 'delete';
    case 'CREATE':
      return 'create';
    case 'ALTER':
      return 'alter';
    case 'DROP':
      return 'drop';
    default:
      return 'other';
  }
}
