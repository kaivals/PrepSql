import path from 'path';
import fs from 'fs';
import { openSqliteSync } from './sqlite-adapter';

export const DEMO_DB_NAME = 'Demo SQLite (Enterprise)';

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

  // Recreate the database file to ensure the new enterprise company schema is seeded cleanly
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch (e) {
      console.warn("Failed to delete existing database file, ignoring", e);
    }
  }

  const db = openSqliteSync(dbPath);

  try {
    // Enable Foreign Keys in SQLite
    db.exec('PRAGMA foreign_keys = ON;');

    // 1. Create Departments Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        budget REAL NOT NULL,
        location TEXT NOT NULL
      )
    `);

    // 2. Create Employees Table (Self-referencing for reporting structure)
    db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        salary REAL NOT NULL,
        hire_date TEXT NOT NULL,
        department_id INTEGER,
        manager_id INTEGER,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL
      )
    `);

    // 3. Create Projects Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        budget REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('Planning', 'Active', 'Completed', 'On Hold')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        department_id INTEGER,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      )
    `);

    // 4. Create Employee Projects Allocation Table (Many-to-Many Join)
    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_projects (
        employee_id INTEGER,
        project_id INTEGER,
        role_in_project TEXT NOT NULL,
        hours_allocated INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (employee_id, project_id),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // 5. Create Customers Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        city TEXT NOT NULL,
        country TEXT NOT NULL
      )
    `);

    // 6. Create Products Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit_price REAL NOT NULL,
        stock_quantity INTEGER NOT NULL DEFAULT 0
      )
    `);

    // 7. Create Sales Table (Deals header)
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        sale_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('Completed', 'Pending', 'Cancelled')),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
      )
    `);

    // 8. Create Sales Items Table (Order line items detail)
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price REAL NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
      )
    `);

    // 9. Create Performance Reviews Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS performance_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        reviewer_id INTEGER NOT NULL,
        review_date TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comments TEXT,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_id) REFERENCES employees(id) ON DELETE RESTRICT
      )
    `);

    // Create Indexes for performance query plans
    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_employee_projects_project ON employee_projects(project_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_employee ON sales(employee_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_items_sale ON sales_items(sale_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_items_product ON sales_items(product_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee ON performance_reviews(employee_id);');

    // Seed Data
    // Seed Departments
    const insertDept = db.prepare('INSERT INTO departments (id, name, budget, location) VALUES (?, ?, ?, ?)');
    const departments = [
      [1, 'Engineering', 1500000.00, 'San Francisco'],
      [2, 'Sales & Marketing', 800000.00, 'New York'],
      [3, 'Human Resources', 250000.00, 'San Francisco'],
      [4, 'Finance', 350000.00, 'New York'],
      [5, 'Customer Success', 400000.00, 'Chicago'],
    ];
    for (const d of departments) {
      insertDept.run(...d);
    }

    // Seed Employees (CEO, VPs, Managers, Individual Contributors)
    const insertEmp = db.prepare('INSERT INTO employees (id, first_name, last_name, email, role, salary, hire_date, department_id, manager_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const employees = [
      [1, 'Sarah', 'Connor', 'sarah.connor@company.com', 'CEO', 250000.00, '2020-01-15', null, null],
      [2, 'Alice', 'Smith', 'alice.smith@company.com', 'VP of Engineering', 180000.00, '2022-01-10', 1, 1],
      [3, 'Bob', 'Jones', 'bob.jones@company.com', 'Lead Developer', 135000.00, '2022-06-15', 1, 2],
      [4, 'Carol', 'Vance', 'carol.vance@company.com', 'Software Engineer', 105000.00, '2023-03-01', 1, 3],
      [5, 'David', 'Miller', 'david.miller@company.com', 'Director of Sales', 120000.00, '2022-02-15', 2, 1],
      [6, 'Eve', 'Davis', 'eve.davis@company.com', 'Senior Sales Rep', 95000.00, '2023-07-22', 2, 5],
      [7, 'Frank', 'White', 'frank.white@company.com', 'HR Director', 95000.00, '2021-11-01', 3, 1],
      [8, 'Grace', 'Hopper', 'grace.hopper@company.com', 'DevOps Engineer', 125000.00, '2023-10-10', 1, 2],
      [9, 'Henry', 'Higgins', 'henry.higgins@company.com', 'Financial Controller', 110000.00, '2024-01-15', 4, 1],
      [10, 'Ivy', 'Green', 'ivy.green@company.com', 'Customer Success Manager', 85000.00, '2023-05-18', 5, 1],
      [11, 'Jack', 'Black', 'jack.black@company.com', 'Support Specialist', 60000.00, '2024-02-10', 5, 10],
    ];
    for (const e of employees) {
      insertEmp.run(...e);
    }

    // Seed Projects
    const insertProj = db.prepare('INSERT INTO projects (id, name, budget, status, start_date, end_date, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const projects = [
      [1, 'Project Alpha', 250000.00, 'Active', '2024-02-01', '2024-12-31', 1],
      [2, 'Project Beta', 150000.00, 'Active', '2024-05-10', null, 1],
      [3, 'Market Expansion 2026', 80000.00, 'Planning', '2026-03-15', '2026-09-30', 2],
      [4, 'Financial Audit System', 50000.00, 'Completed', '2023-09-01', '2023-12-15', 4],
      [5, 'HR Portal Upgrade', 30000.00, 'On Hold', '2025-01-10', null, 3],
    ];
    for (const p of projects) {
      insertProj.run(...p);
    }

    // Seed Employee Projects allocations
    const insertEmpProj = db.prepare('INSERT INTO employee_projects (employee_id, project_id, role_in_project, hours_allocated) VALUES (?, ?, ?, ?)');
    const employeeProjects = [
      [2, 1, 'Sponsor', 5],
      [3, 1, 'Technical Lead', 30],
      [4, 1, 'Developer', 40],
      [3, 2, 'Developer', 15],
      [8, 2, 'DevOps Lead', 25],
      [9, 4, 'Financial Lead', 20],
    ];
    for (const ep of employeeProjects) {
      insertEmpProj.run(...ep);
    }

    // Seed Customers
    const insertCust = db.prepare('INSERT INTO customers (id, company_name, contact_name, email, phone, city, country) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const customers = [
      [1, 'Acme Corp', 'John Coyote', 'coyote@acme.com', '555-0100', 'Austin', 'USA'],
      [2, 'Globex Corp', 'Hank Scorpio', 'scorpio@globex.com', '555-0200', 'Cypress Creek', 'USA'],
      [3, 'Initech LLC', 'Peter Gibbons', 'gibbons@initech.com', '555-0300', 'Houston', 'USA'],
      [4, 'Umbrella Corp', 'Albert Wesker', 'wesker@umbrella.com', '555-0400', 'London', 'UK'],
      [5, 'Wayne Enterprises', 'Bruce Wayne', 'bruce@wayne.com', '555-0500', 'Gotham', 'USA'],
      [6, 'Stark Industries', 'Pepper Potts', 'pepper@stark.com', '555-0600', 'Los Angeles', 'USA'],
    ];
    for (const c of customers) {
      insertCust.run(...c);
    }

    // Seed Products
    const insertProd = db.prepare('INSERT INTO products (id, sku, name, category, unit_price, stock_quantity) VALUES (?, ?, ?, ?, ?, ?)');
    const products = [
      [1, 'PROD-CLOUD-ENT', 'Enterprise Cloud Hosting (Annual)', 'SaaS', 12000.00, 1000],
      [2, 'PROD-CLOUD-BIZ', 'Business Cloud Hosting (Annual)', 'SaaS', 4800.00, 5000],
      [3, 'PROD-SUPPORT-PREM', 'Premium Support & SLA (Annual)', 'Services', 2500.00, 9999],
      [4, 'PROD-CONSULT-DAY', 'Professional Services Consultation (Daily)', 'Services', 1500.00, 9999],
      [5, 'PROD-IOT-GATE', 'Smart IoT Edge Gateway Hardware', 'Hardware', 450.00, 120],
    ];
    for (const pr of products) {
      insertProd.run(...pr);
    }

    // Seed Sales Deals
    const insertSale = db.prepare('INSERT INTO sales (id, customer_id, employee_id, amount, sale_date, status) VALUES (?, ?, ?, ?, ?, ?)');
    const sales = [
      [1, 1, 5, 14500.00, '2024-03-01', 'Completed'],
      [2, 2, 6, 120000.00, '2024-04-10', 'Completed'],
      [3, 3, 6, 14200.00, '2024-05-15', 'Completed'],
      [4, 4, 5, 62500.00, '2024-06-20', 'Pending'],
      [5, 5, 6, 250000.00, '2024-07-05', 'Completed'],
      [6, 6, 6, 36500.00, '2024-08-12', 'Completed'],
    ];
    for (const s of sales) {
      insertSale.run(...s);
    }

    // Seed Sales Items
    const insertSaleItem = db.prepare('INSERT INTO sales_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)');
    const salesItems = [
      // Sale 1 items (Total: 14500.00)
      [1, 2, 2, 4800.00], // 9600.00
      [1, 3, 1, 2500.00], // 2500.00
      [1, 5, 2, 450.00],  // 900.00
      [1, 4, 1, 1500.00], // 1500.00

      // Sale 2 items (Total: 120000.00)
      [2, 1, 10, 12000.00],

      // Sale 3 items (Total: 14200.00)
      [3, 2, 1, 4800.00], // 4800.00
      [3, 3, 1, 2500.00], // 2500.00
      [3, 4, 4, 1500.00], // 6000.00
      [3, 5, 2, 450.00],  // 900.00

      // Sale 4 items (Total: 62500.00)
      [4, 1, 5, 12000.00], // 60000.00
      [4, 3, 1, 2500.00],  // 2500.00

      // Sale 5 items (Total: 250000.00)
      [5, 1, 20, 12000.00], // 240000.00
      [5, 3, 4, 2500.00],   // 10000.00

      // Sale 6 items (Total: 36500.00)
      [6, 2, 5, 4800.00], // 24000.00
      [6, 3, 2, 2500.00], // 5000.00
      [6, 4, 5, 1500.00], // 7500.00
    ];
    for (const si of salesItems) {
      insertSaleItem.run(...si);
    }

    // Seed Performance Reviews
    const insertReview = db.prepare('INSERT INTO performance_reviews (id, employee_id, reviewer_id, review_date, rating, comments) VALUES (?, ?, ?, ?, ?, ?)');
    const reviews = [
      [1, 3, 2, '2024-12-15', 5, 'Bob has shown exceptional leadership in guiding the developer team for Project Alpha. Code quality is excellent.'],
      [2, 4, 3, '2024-12-10', 4, 'Carol is a strong software engineer, delivering key features on time. Solid team player.'],
      [3, 6, 5, '2024-12-18', 5, 'Eve exceeded her sales quota by 150% this year. Outstanding relationship building and deal closure.'],
      [4, 8, 2, '2024-12-14', 4, 'Grace has successfully automated our build pipelines for Project Beta, lowering release times.'],
      [5, 11, 10, '2024-12-12', 3, 'Jack handles support tickets reliably, but should focus on speed of resolution next quarter.'],
    ];
    for (const r of reviews) {
      insertReview.run(...r);
    }

  } finally {
    db.close();
  }

  return dbPath;
}
