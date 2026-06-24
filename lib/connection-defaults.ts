export const POSTGRES_DEFAULTS = {
  type: 'postgresql' as const,
  name: 'LocalPostgreSQL',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  database: 'sequelize_db',
  password: '',
};

export interface SavedConnection {
  type: 'postgresql' | 'sqlite' | 'mysql' | 'mariadb';
  name: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  filepath?: string;
}
