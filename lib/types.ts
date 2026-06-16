export type DatabaseType = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb'
export type QueryMode = 'readonly' | 'crud' | 'analytics' | 'indexes'

export interface DatabaseConnection {
  id: string
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  filepath?: string
  name: string
}

export interface SchemaColumn {
  name: string
  type: string
}

export interface SchemaTable {
  name: string
  columns: SchemaColumn[]
  rowCount: number
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  rowsAffected?: number
  truncated?: boolean
}

export interface QueryHistoryItem {
  id: string
  prompt: string
  sql: string
  timestamp: number
  success: boolean
  error?: string
  rowsAffected?: number
}
