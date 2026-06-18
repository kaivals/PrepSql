/**
 * pg-identifiers.ts
 *
 * Utilities for quoting PostgreSQL identifiers correctly.
 *
 * PostgreSQL rules:
 *  - Unquoted identifiers are folded to lowercase.
 *  - Quoted identifiers preserve exact casing.
 *  - Therefore, any identifier that is not purely lowercase ASCII must be quoted.
 *  - We ALWAYS quote to be safe and consistent — there is no downside to quoting
 *    an already-lowercase name.
 */

/** Always wrap a PostgreSQL identifier in double-quotes (escaping embedded quotes). */
export function quotePgIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Convenience wrapper — same as quotePgIdentifier. */
export function quotePgTable(name: string): string {
  return quotePgIdentifier(name);
}

/** Convenience wrapper — same as quotePgIdentifier. */
export function quotePgColumn(name: string): string {
  return quotePgIdentifier(name);
}

/**
 * Determine whether an identifier needs quoting in PostgreSQL.
 * An identifier is "safe" (no quoting needed) only when it is all lowercase ASCII
 * letters, digits, and underscores, and does not start with a digit.
 * We still prefer to always quote for consistency.
 */
export function pgIdentifierNeedsQuoting(name: string): boolean {
  return !/^[a-z_][a-z0-9_]*$/.test(name);
}
