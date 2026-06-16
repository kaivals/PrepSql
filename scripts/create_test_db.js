const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'test.db');
console.log(`Creating/opening SQLite database at: ${dbPath}`);

const db = new DatabaseSync(dbPath);

// Drop existing tables if they exist to start fresh
db.exec(`DROP TABLE IF EXISTS order_items;`);
db.exec(`DROP TABLE IF EXISTS orders;`);
db.exec(`DROP TABLE IF EXISTS products;`);
db.exec(`DROP TABLE IF EXISTS users;`);

// Create users table
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create products table
db.exec(`
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    category TEXT
  );
`);

// Create orders table
db.exec(`
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    total_amount REAL DEFAULT 0.0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Create order_items table (optional, but let's make it 3 main tables as requested: users, products, orders. That is 3 tables!)
// Let's populate some dummy data
const insertUser = db.prepare(`INSERT INTO users (name, email, role) VALUES (?, ?, ?);`);
insertUser.run('Alice Smith', 'alice@example.com', 'admin');
insertUser.run('Bob Johnson', 'bob@example.com', 'user');
insertUser.run('Charlie Brown', 'charlie@example.com', 'user');
insertUser.run('Diana Prince', 'diana@example.com', 'user');

const insertProduct = db.prepare(`INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?);`);
insertProduct.run('Wireless Mouse', 29.99, 150, 'Electronics');
insertProduct.run('Mechanical Keyboard', 89.99, 80, 'Electronics');
insertProduct.run('USB-C Hub', 19.99, 200, 'Electronics');
insertProduct.run('Coffee Mug', 12.99, 50, 'Kitchenware');
insertProduct.run('Leather Notebook', 15.50, 120, 'Stationery');

const insertOrder = db.prepare(`INSERT INTO orders (user_id, total_amount, status, order_date) VALUES (?, ?, ?, ?);`);
insertOrder.run(1, 49.98, 'completed', '2026-06-10 10:30:00');
insertOrder.run(2, 89.99, 'completed', '2026-06-12 14:15:00');
insertOrder.run(3, 12.99, 'pending', '2026-06-15 09:00:00');
insertOrder.run(1, 15.50, 'shipped', '2026-06-16 11:20:00');

console.log('Tables created and dummy data populated successfully!');

// Let's print out what we have to confirm
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").all();
console.log('Tables in database:', tables.map(t => t.name).join(', '));

db.close();
