/** Quote a PostgreSQL identifier when it needs quoting (mixed case, reserved words, etc.) */
export function quotePgIdentifier(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name)) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function quotePgTable(name: string): string {
  return quotePgIdentifier(name);
}
