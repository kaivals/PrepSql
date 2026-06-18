export type DatabaseType = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb'
export type QueryMode = 'crud' | 'analytics' | 'schema'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}


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
  nullable: boolean
  defaultValue: string | null
  primaryKey: boolean
  unique: boolean
  autoIncrement: boolean
  foreignKey?: {
    table: string;
    column: string;
  } | null;
}

export interface SchemaTable {
  name: string
  columns: SchemaColumn[]
  rowCount: number
  indexes?: string[]
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
  executionTime?: number
  rowsScanned?: number
  rowsReturned?: number
  cpuUsage?: number
  memoryUsage?: number
  indexesUsed?: string[]
}
