export type DatabaseType = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb'
export type QueryMode = 'crud' | 'analytics' | 'schema'

/** Coarse classification of an executed statement, derived from the SQL verb. */
export type QueryType =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'create'
  | 'alter'
  | 'drop'
  | 'other'

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

export interface TimelineStep {
  id: string
  type: 'initial_ai' | 'validation' | 'schema_discovery' | 'optimization_rewrite' | 'final_executed'
  sql: string
  timestamp: number
  success: boolean
  executionTime?: number
  rowsAffected?: number
  error?: string
}

export interface QueryHistoryItem {
  id: string
  prompt: string
  sql: string
  timestamp: number
  success: boolean
  error?: string
  /** Classified statement type (select / insert / update / delete / create / alter / drop / other). */
  queryType?: QueryType
  /** Connection the query ran against, captured at execution time. */
  connectionId?: string
  connectionName?: string
  rowsAffected?: number
  executionTime?: number
  rowsScanned?: number
  rowsReturned?: number
  cpuUsage?: number
  memoryUsage?: number
  indexesUsed?: string[]
  timeline?: TimelineStep[]
  principlesValidation?: {
    dry: { status: 'follows' | 'violates' | 'n/a'; description: string }
    yagni: { status: 'follows' | 'violates' | 'n/a'; description: string }
    kiss: { status: 'follows' | 'violates' | 'n/a'; description: string }
    solid: { status: 'follows' | 'violates' | 'n/a'; description: string }
    concerns: string[]
  }
}
