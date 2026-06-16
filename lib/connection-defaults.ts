export const POSTGRES_DEFAULTS = {
  type: 'postgresql' as const,
  name: 'LocalPostgreSQL',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  database: 'sequelize_db',
  password: '',
};

export const CREDENTIALS_STORAGE_KEY = 'prepsql-saved-connection';

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

export function loadSavedConnection(): SavedConnection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (!raw) return { ...POSTGRES_DEFAULTS };
    return JSON.parse(raw) as SavedConnection;
  } catch {
    return { ...POSTGRES_DEFAULTS };
  }
}

export function saveConnection(credentials: SavedConnection): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(credentials));
}

export function clearSavedConnection(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
}

