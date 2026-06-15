import path from 'path';
import fs from 'fs';
import { openSqliteSync } from './sqlite-adapter';

export const DEMO_DB_NAME = 'Demo SQLite (Sales)';

export function getDemoDbPath(): string {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'demo_db.sqlite');
}

export function getDemoConnection() {
  return {
    type: 'sqlite' as const,
    name: DEMO_DB_NAME,
    filepath: getDemoDbPath(),
  };
}

export async function ensureDemoDatabase(): Promise<string> {
  const dbPath = getDemoDbPath();
  const db = openSqliteSync(dbPath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        category TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        order_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    const count = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };

    if (count.count === 0) {
      const insertUser = db.prepare(
        'INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)'
      );
      const users = [
        [1, 'Alice Johnson', 'alice@example.com', '2025-01-15'],
        [2, 'Bob Smith', 'bob@example.com', '2025-02-20'],
        [3, 'Carol Williams', 'carol@example.com', '2025-03-10'],
        [4, 'David Brown', 'david@example.com', '2025-04-05'],
        [5, 'Eve Davis', 'eve@example.com', '2025-05-18'],
      ];
      for (const u of users) {
        insertUser.run(...u);
      }

      const insertProduct = db.prepare(
        'INSERT INTO products (id, name, price, category) VALUES (?, ?, ?, ?)'
      );
      const products = [
        [1, 'Laptop Pro', 1299.99, 'Electronics'],
        [2, 'Wireless Mouse', 49.99, 'Electronics'],
        [3, 'Office Chair', 349.99, 'Furniture'],
        [4, 'Standing Desk', 599.99, 'Furniture'],
        [5, 'USB-C Hub', 79.99, 'Electronics'],
      ];
      for (const p of products) {
        insertProduct.run(...p);
      }

      const insertOrder = db.prepare(
        'INSERT INTO orders (id, user_id, product_id, quantity, order_date) VALUES (?, ?, ?, ?, ?)'
      );
      const orders = [
        [1, 1, 1, 1, '2025-06-01'],
        [2, 1, 3, 2, '2025-06-15'],
        [3, 2, 2, 3, '2025-07-01'],
        [4, 3, 4, 1, '2025-07-20'],
        [5, 4, 5, 2, '2025-08-05'],
        [6, 5, 1, 1, '2025-08-22'],
      ];
      for (const o of orders) {
        insertOrder.run(...o);
      }
    }
  } finally {
    db.close();
  }

  return dbPath;
}
