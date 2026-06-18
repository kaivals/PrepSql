const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'data.db');
console.log(`Creating/opening SQLite database at: ${dbPath}`);

// If file exists, delete it first to start fresh
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new DatabaseSync(dbPath);

// Enable foreign key constraints in SQLite
db.exec('PRAGMA foreign_keys = ON;');

// Create tables
console.log('Creating tables...');

db.exec(`
  CREATE TABLE departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    budget REAL NOT NULL,
    location TEXT NOT NULL,
    manager_id INTEGER,
    FOREIGN KEY(manager_id) REFERENCES employees(id) ON DELETE SET NULL
  );
`);

db.exec(`
  CREATE TABLE employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    hire_date DATE NOT NULL,
    job_title TEXT NOT NULL,
    salary REAL NOT NULL,
    department_id INTEGER,
    manager_id INTEGER,
    FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY(manager_id) REFERENCES employees(id) ON DELETE SET NULL
  );
`);

db.exec(`
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    budget REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Planning', 'Active', 'Completed', 'On Hold'))
  );
`);

db.exec(`
  CREATE TABLE employee_projects (
    employee_id INTEGER,
    project_id INTEGER,
    role TEXT NOT NULL,
    hours_per_week INTEGER DEFAULT 40,
    PRIMARY KEY (employee_id, project_id),
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE performance_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    review_date DATE NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
    feedback TEXT,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(reviewer_id) REFERENCES employees(id) ON DELETE CASCADE
  );
`);

console.log('Tables created. Inserting seed data...');

// 1. Insert Departments first (with manager_id as NULL initially)
const insertDept = db.prepare(`
  INSERT INTO departments (name, budget, location, manager_id)
  VALUES (?, ?, ?, NULL);
`);

const depts = [
  { name: 'Executive', budget: 1000000.00, location: 'San Francisco' },
  { name: 'Engineering', budget: 2500000.00, location: 'San Francisco' },
  { name: 'Marketing', budget: 800000.00, location: 'New York' },
  { name: 'Sales', budget: 1200000.00, location: 'Chicago' },
  { name: 'Human Resources', budget: 3500000.00, location: 'Austin' },
  { name: 'Finance', budget: 900000.00, location: 'New York' }
];

const deptIds = {};
for (const dept of depts) {
  const info = insertDept.run(dept.name, dept.budget, dept.location);
  deptIds[dept.name] = info.lastInsertRowid;
}

// 2. Insert Employees
const insertEmp = db.prepare(`
  INSERT INTO employees (first_name, last_name, email, phone, hire_date, job_title, salary, department_id, manager_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
`);

// We'll structure employee inserts carefully to reference correct managers.
// Top executive: Alice Vance (CEO, reports to none)
const ceoInfo = insertEmp.run('Alice', 'Vance', 'alice.vance@company.com', '555-0100', '2020-01-15', 'Chief Executive Officer', 280000.00, deptIds['Executive'], null);
const ceoId = ceoInfo.lastInsertRowid;

// Department Heads (Report to CEO)
const managers = [
  { first: 'Bob', last: 'Miller', email: 'bob.miller@company.com', phone: '555-0101', hire: '2020-03-10', title: 'VP of Engineering', salary: 185000.00, dept: 'Engineering' },
  { first: 'Carol', last: 'Davis', email: 'carol.davis@company.com', phone: '555-0102', hire: '2020-05-12', title: 'Marketing Director', salary: 135000.00, dept: 'Marketing' },
  { first: 'David', last: 'Wilson', email: 'david.wilson@company.com', phone: '555-0103', hire: '2020-06-01', title: 'VP of Sales', salary: 145000.00, dept: 'Sales' },
  { first: 'Emma', last: 'Taylor', email: 'emma.taylor@company.com', phone: '555-0104', hire: '2021-02-15', title: 'HR Director', salary: 110000.00, dept: 'Human Resources' },
  { first: 'Frank', last: 'Thomas', email: 'frank.thomas@company.com', phone: '555-0105', hire: '2020-11-01', title: 'Chief Financial Officer', salary: 195000.00, dept: 'Finance' }
];

const managerIds = {};
for (const mgr of managers) {
  const info = insertEmp.run(mgr.first, mgr.last, mgr.email, mgr.phone, mgr.hire, mgr.title, mgr.salary, deptIds[mgr.dept], ceoId);
  managerIds[mgr.dept] = info.lastInsertRowid;
}

// Update the departments with their managers
const updateDeptManager = db.prepare(`
  UPDATE departments SET manager_id = ? WHERE id = ?;
`);
updateDeptManager.run(ceoId, deptIds['Executive']);
updateDeptManager.run(managerIds['Engineering'], deptIds['Engineering']);
updateDeptManager.run(managerIds['Marketing'], deptIds['Marketing']);
updateDeptManager.run(managerIds['Sales'], deptIds['Sales']);
updateDeptManager.run(managerIds['Human Resources'], deptIds['Human Resources']);
updateDeptManager.run(managerIds['Finance'], deptIds['Finance']);

// General Staff
const staff = [
  // Engineering Reports to Bob Miller
  { first: 'Grace', last: 'Hopper', email: 'grace.hopper@company.com', phone: '555-0201', hire: '2021-06-01', title: 'Principal Software Engineer', salary: 160000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Alan', last: 'Turing', email: 'alan.turing@company.com', phone: '555-0202', hire: '2021-07-15', title: 'Senior Software Engineer', salary: 135000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Ada', last: 'Lovelace', email: 'ada.lovelace@company.com', phone: '555-0203', hire: '2022-01-10', title: 'Software Engineer II', salary: 105000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Margaret', last: 'Hamilton', email: 'margaret.hamilton@company.com', phone: '555-0204', hire: '2022-03-22', title: 'Senior DevOps Engineer', salary: 140000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Linus', last: 'Torvalds', email: 'linus.torvalds@company.com', phone: '555-0205', hire: '2022-05-18', title: 'Kernel Engineer', salary: 150000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Ken', last: 'Thompson', email: 'ken.thompson@company.com', phone: '555-0206', hire: '2022-09-01', title: 'Software Engineer II', salary: 110000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Dennis', last: 'Ritchie', email: 'dennis.ritchie@company.com', phone: '555-0207', hire: '2022-09-01', title: 'Systems Architect', salary: 155000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Guido', last: 'van Rossum', email: 'guido.vanrossum@company.com', phone: '555-0208', hire: '2023-02-01', title: 'Software Engineer I', salary: 90000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Yukihiro', last: 'Matsumoto', email: 'matz@company.com', phone: '555-0209', hire: '2023-06-15', title: 'Software Engineer I', salary: 92000.00, dept: 'Engineering', mgr: 'Engineering' },
  { first: 'Tim', last: 'Berners-Lee', email: 'tim.bl@company.com', phone: '555-0210', hire: '2023-11-10', title: 'Web Developer', salary: 88000.00, dept: 'Engineering', mgr: 'Engineering' },

  // Marketing Reports to Carol Davis
  { first: 'Helen', last: 'Keller', email: 'helen.keller@company.com', phone: '555-0301', hire: '2021-08-01', title: 'Content Manager', salary: 75000.00, dept: 'Marketing', mgr: 'Marketing' },
  { first: 'Maya', last: 'Angelou', email: 'maya.angelou@company.com', phone: '555-0302', hire: '2022-02-14', title: 'Copywriter', salary: 65000.00, dept: 'Marketing', mgr: 'Marketing' },
  { first: 'George', last: 'Orwell', email: 'george.orwell@company.com', phone: '555-0303', hire: '2022-08-01', title: 'SEO Specialist', salary: 70000.00, dept: 'Marketing', mgr: 'Marketing' },
  { first: 'Virginia', last: 'Woolf', email: 'virginia.woolf@company.com', phone: '555-0304', hire: '2023-01-20', title: 'Social Media Manager', salary: 68000.00, dept: 'Marketing', mgr: 'Marketing' },

  // Sales Reports to David Wilson
  { first: 'James', last: 'Smith', email: 'james.smith@company.com', phone: '555-0401', hire: '2021-03-01', title: 'Account Executive', salary: 85000.00, dept: 'Sales', mgr: 'Sales' },
  { first: 'Mary', last: 'Johnson', email: 'mary.johnson@company.com', phone: '555-0402', hire: '2021-09-10', title: 'Senior Account Executive', salary: 95000.00, dept: 'Sales', mgr: 'Sales' },
  { first: 'John', last: 'Williams', email: 'john.williams@company.com', phone: '555-0403', hire: '2022-04-05', title: 'Sales Representative', salary: 60000.00, dept: 'Sales', mgr: 'Sales' },
  { first: 'Patricia', last: 'Brown', email: 'patricia.brown@company.com', phone: '555-0404', hire: '2022-11-12', title: 'Sales Representative', salary: 62000.00, dept: 'Sales', mgr: 'Sales' },
  { first: 'Robert', last: 'Jones', email: 'robert.jones@company.com', phone: '555-0405', hire: '2023-05-01', title: 'Account Manager', salary: 78000.00, dept: 'Sales', mgr: 'Sales' },

  // HR Reports to Emma Taylor
  { first: 'Linda', last: 'Garcia', email: 'linda.garcia@company.com', phone: '555-0501', hire: '2021-10-01', title: 'HR Generalist', salary: 72000.00, dept: 'Human Resources', mgr: 'Human Resources' },
  { first: 'Michael', last: 'Martinez', email: 'michael.martinez@company.com', phone: '555-0502', hire: '2022-07-19', title: 'Recruiting Coordinator', salary: 64000.00, dept: 'Human Resources', mgr: 'Human Resources' },
  { first: 'Elizabeth', last: 'Robinson', email: 'elizabeth.robinson@company.com', phone: '555-0503', hire: '2023-04-10', title: 'Benefits Specialist', salary: 70000.00, dept: 'Human Resources', mgr: 'Human Resources' },

  // Finance Reports to Frank Thomas
  { first: 'William', last: 'Clark', email: 'william.clark@company.com', phone: '555-0601', hire: '2021-04-18', title: 'Senior Accountant', salary: 92000.00, dept: 'Finance', mgr: 'Finance' },
  { first: 'Barbara', last: 'Rodriguez', email: 'barbara.rodriguez@company.com', phone: '555-0602', hire: '2022-05-05', title: 'Financial Analyst', salary: 80000.00, dept: 'Finance', mgr: 'Finance' },
  { first: 'Richard', last: 'Lewis', email: 'richard.lewis@company.com', phone: '555-0603', hire: '2023-03-01', title: 'Accounts Payable Clerk', salary: 58000.00, dept: 'Finance', mgr: 'Finance' }
];

const employeeIds = {};
employeeIds['Alice Vance'] = ceoId;

for (const deptName of Object.keys(managerIds)) {
  const mgrObj = managers.find(m => m.dept === deptName);
  if (mgrObj) {
    employeeIds[`${mgrObj.first} ${mgrObj.last}`] = managerIds[deptName];
  }
}

for (const s of staff) {
  const mgrId = managerIds[s.mgr];
  const info = insertEmp.run(s.first, s.last, s.email, s.phone, s.hire, s.title, s.salary, deptIds[s.dept], mgrId);
  employeeIds[`${s.first} ${s.last}`] = info.lastInsertRowid;
}

// 3. Insert Projects
const insertProject = db.prepare(`
  INSERT INTO projects (name, description, start_date, end_date, budget, status)
  VALUES (?, ?, ?, ?, ?, ?);
`);

const projects = [
  { name: 'Project Alpha', desc: 'Next generation e-commerce backend platform migration.', start: '2025-01-10', end: '2025-12-20', budget: 500000.00, status: 'Completed' },
  { name: 'Project Beta', desc: 'Customer data integration and compliance framework.', start: '2025-03-15', end: '2026-02-28', budget: 350000.00, status: 'Completed' },
  { name: 'Project Gamma', desc: 'AI-powered predictive sales forecasting assistant tool.', start: '2026-01-05', end: null, budget: 750000.00, status: 'Active' },
  { name: 'Project Delta', desc: 'Mobile application redesign for iOS and Android platforms.', start: '2026-03-01', end: null, budget: 450000.00, status: 'Active' },
  { name: 'Project Epsilon', desc: 'Global market campaign for new product line launch.', start: '2026-05-01', end: '2026-11-30', budget: 200000.00, status: 'Active' },
  { name: 'Project Zeta', desc: 'Infrastructure server consolidation and cloud cost optimization.', start: '2026-07-01', end: null, budget: 150000.00, status: 'Planning' },
  { name: 'Project Eta', desc: 'Corporate HR talent recruitment portal revamp.', start: '2026-02-10', end: null, budget: 120000.00, status: 'On Hold' }
];

const projectIds = {};
for (const p of projects) {
  const info = insertProject.run(p.name, p.desc, p.start, p.end, p.budget, p.status);
  projectIds[p.name] = info.lastInsertRowid;
}

// 4. Insert Employee-Project Assignments
const insertAssignment = db.prepare(`
  INSERT INTO employee_projects (employee_id, project_id, role, hours_per_week)
  VALUES (?, ?, ?, ?);
`);

const assignments = [
  // Project Alpha (Completed)
  { emp: 'Bob Miller', proj: 'Project Alpha', role: 'Project Sponsor', hours: 5 },
  { emp: 'Grace Hopper', proj: 'Project Alpha', role: 'Technical Lead', hours: 35 },
  { emp: 'Ada Lovelace', proj: 'Project Alpha', role: 'Developer', hours: 40 },
  { emp: 'Linus Torvalds', proj: 'Project Alpha', role: 'Kernel Integration Engineer', hours: 20 },
  { emp: 'Dennis Ritchie', proj: 'Project Alpha', role: 'Systems Engineer', hours: 30 },
  { emp: 'Helen Keller', proj: 'Project Alpha', role: 'Documentation lead', hours: 10 },

  // Project Beta (Completed)
  { emp: 'Carol Davis', proj: 'Project Beta', role: 'Project Owner', hours: 10 },
  { emp: 'Margaret Hamilton', proj: 'Project Beta', role: 'DevOps Lead', hours: 35 },
  { emp: 'Ken Thompson', proj: 'Project Beta', role: 'Backend Developer', hours: 40 },
  { emp: 'William Clark', proj: 'Project Beta', role: 'Financial Compliance Auditor', hours: 15 },

  // Project Gamma (Active AI Project)
  { emp: 'Bob Miller', proj: 'Project Gamma', role: 'Project Sponsor', hours: 8 },
  { emp: 'Alan Turing', proj: 'Project Gamma', role: 'AI Lead Researcher', hours: 40 },
  { emp: 'Grace Hopper', proj: 'Project Gamma', role: 'Architect', hours: 20 },
  { emp: 'Guido van Rossum', proj: 'Project Gamma', role: 'Developer (Python)', hours: 40 },
  { emp: 'Yukihiro Matsumoto', proj: 'Project Gamma', role: 'Developer (Ruby/APIs)', hours: 30 },
  { emp: 'Mary Johnson', proj: 'Project Gamma', role: 'Sales Liaison', hours: 10 },

  // Project Delta (Active Mobile Redesign)
  { emp: 'Bob Miller', proj: 'Project Delta', role: 'Project Sponsor', hours: 5 },
  { emp: 'Tim Berners-Lee', proj: 'Project Delta', role: 'Frontend Lead', hours: 40 },
  { emp: 'Ada Lovelace', proj: 'Project Delta', role: 'Mobile Developer', hours: 30 },
  { emp: 'Virginia Woolf', proj: 'Project Delta', role: 'UI/UX Coordinator', hours: 25 },
  { emp: 'Helen Keller', proj: 'Project Delta', role: 'Marketing Representative', hours: 15 },

  // Project Epsilon (Active Marketing Campaign)
  { emp: 'Carol Davis', proj: 'Project Epsilon', role: 'Campaign Lead', hours: 30 },
  { emp: 'Helen Keller', proj: 'Project Epsilon', role: 'Content Strategy Manager', hours: 20 },
  { emp: 'Maya Angelou', proj: 'Project Epsilon', role: 'Copywriter', hours: 40 },
  { emp: 'George Orwell', proj: 'Project Epsilon', role: 'SEO Lead', hours: 35 },
  { emp: 'Virginia Woolf', proj: 'Project Epsilon', role: 'Social Coordinator', hours: 20 },
  { emp: 'James Smith', proj: 'Project Epsilon', role: 'Sales Lead', hours: 15 },

  // Project Zeta (Planning Cloud Ops)
  { emp: 'Margaret Hamilton', proj: 'Project Zeta', role: 'Infrastructure Lead', hours: 10 },
  { emp: 'Linus Torvalds', proj: 'Project Zeta', role: 'Advisor', hours: 5 },
  { emp: 'Dennis Ritchie', proj: 'Project Zeta', role: 'Consultant', hours: 5 },
  { emp: 'Barbara Rodriguez', proj: 'Project Zeta', role: 'Budget Controller', hours: 8 },

  // Project Eta (On Hold HR Portal)
  { emp: 'Emma Taylor', proj: 'Project Eta', role: 'Project Sponsor', hours: 2 },
  { emp: 'Linda Garcia', proj: 'Project Eta', role: 'HR Coordinator', hours: 10 },
  { emp: 'Michael Martinez', proj: 'Project Eta', role: 'Recruiting Auditor', hours: 10 }
];

for (const a of assignments) {
  const eId = employeeIds[a.emp];
  const pId = projectIds[a.proj];
  if (eId && pId) {
    insertAssignment.run(eId, pId, a.role, a.hours);
  } else {
    console.warn(`Could not resolve assignment: ${a.emp} to ${a.proj}`);
  }
}

// 5. Insert Performance Reviews
const insertReview = db.prepare(`
  INSERT INTO performance_reviews (employee_id, reviewer_id, review_date, score, feedback)
  VALUES (?, ?, ?, ?, ?);
`);

const reviews = [
  // Reviews by CEO (Alice Vance)
  { emp: 'Bob Miller', reviewer: 'Alice Vance', date: '2025-12-15', score: 5, feedback: 'Bob has done an outstanding job leading the engineering department. Completed both Project Alpha and Beta successfully.' },
  { emp: 'Carol Davis', reviewer: 'Alice Vance', date: '2025-12-16', score: 4, feedback: 'Carol led the marketing team to hit all major user acquisition targets. Excellent work on Project Beta campaign.' },
  { emp: 'David Wilson', reviewer: 'Alice Vance', date: '2025-12-17', score: 4, feedback: 'David restructured sales divisions and hit global revenue goals. Needs to focus slightly more on integration with tech projects.' },
  { emp: 'Frank Thomas', reviewer: 'Alice Vance', date: '2025-12-18', score: 5, feedback: 'Frank has maintained impeccable financial controls, keeping general department budgets well within limits.' },
  
  // Reviews by VP of Eng (Bob Miller)
  { emp: 'Grace Hopper', reviewer: 'Bob Miller', date: '2025-11-20', score: 5, feedback: 'Grace is an invaluable asset. Her leadership on Project Alpha architecture was exceptional. Shows deep technical expertise.' },
  { emp: 'Alan Turing', reviewer: 'Bob Miller', date: '2025-11-21', score: 5, feedback: 'Alan is leading our AI initiatives brilliantly on Project Gamma. His research is state of the art.' },
  { emp: 'Ada Lovelace', reviewer: 'Bob Miller', date: '2025-11-22', score: 4, feedback: 'Ada contributed major feature additions to Project Alpha. Outstanding programming skills, occasionally needs to align on timeline estimates.' },
  { emp: 'Margaret Hamilton', reviewer: 'Bob Miller', date: '2025-11-23', score: 5, feedback: 'Margaret\'s infrastructure setup saved us from major downtime during the transition. Absolute professional.' },
  { emp: 'Linus Torvalds', reviewer: 'Bob Miller', date: '2025-11-24', score: 4, feedback: 'Linus produces extremely high-quality code. Code reviews are strict but highly constructive.' },
  { emp: 'Tim Berners-Lee', reviewer: 'Bob Miller', date: '2026-05-10', score: 4, feedback: 'Tim is doing a great job leading the frontend transition. Highly responsive to design feedback.' },
  { emp: 'Guido van Rossum', reviewer: 'Bob Miller', date: '2026-05-11', score: 4, feedback: 'Guido has been coding very clean, readable APIs for the sales predictor assistant.' },

  // Reviews by Marketing Director (Carol Davis)
  { emp: 'Helen Keller', reviewer: 'Carol Davis', date: '2025-12-05', score: 4, feedback: 'Helen has managed Content extremely well and coordinated across multiple projects seamlessly.' },
  { emp: 'Maya Angelou', reviewer: 'Carol Davis', date: '2025-12-06', score: 5, feedback: 'Maya\'s copies are outstanding and have driven a 20% increase in ad engagement rates.' },
  { emp: 'George Orwell', reviewer: 'Carol Davis', date: '2025-12-07', score: 3, feedback: 'George does great SEO work but needs to improve collaboration with the broader marketing team.' },

  // Reviews by VP of Sales (David Wilson)
  { emp: 'Mary Johnson', reviewer: 'David Wilson', date: '2025-12-10', score: 5, feedback: 'Mary is our top account executive. Exceeded quota by 35% in Q3 and Q4. Promoted to Senior.' },
  { emp: 'James Smith', reviewer: 'David Wilson', date: '2025-12-11', score: 4, feedback: 'James shows great drive. Solid sales numbers and strong customer relationship building.' },

  // Reviews by HR Director (Emma Taylor)
  { emp: 'Linda Garcia', reviewer: 'Emma Taylor', date: '2025-12-12', score: 4, feedback: 'Linda handles employee relations very professionally and has streamlined the onboarding process.' }
];

for (const r of reviews) {
  const eId = employeeIds[r.emp];
  const rId = employeeIds[r.reviewer];
  if (eId && rId) {
    insertReview.run(eId, rId, r.date, r.score, r.feedback);
  } else {
    console.warn(`Could not resolve review: ${r.emp} by ${r.reviewer}`);
  }
}

console.log('Seed data inserted successfully!');

// Verification query
console.log('\n--- VERIFICATION STATS ---');
const totalDepts = db.prepare('SELECT COUNT(*) as count FROM departments;').get();
const totalEmps = db.prepare('SELECT COUNT(*) as count FROM employees;').get();
const totalProjs = db.prepare('SELECT COUNT(*) as count FROM projects;').get();
const totalAssigns = db.prepare('SELECT COUNT(*) as count FROM employee_projects;').get();
const totalReviews = db.prepare('SELECT COUNT(*) as count FROM performance_reviews;').get();

console.log(`Departments: ${totalDepts.count}`);
console.log(`Employees:   ${totalEmps.count}`);
console.log(`Projects:    ${totalProjs.count}`);
console.log(`Assignments: ${totalAssigns.count}`);
console.log(`Reviews:     ${totalReviews.count}`);

console.log('\nAverage salary by department:');
const avgSalaries = db.prepare(`
  SELECT d.name, COUNT(e.id) as num_employees, ROUND(AVG(e.salary), 2) as avg_salary
  FROM departments d
  JOIN employees e ON d.id = e.department_id
  GROUP BY d.name
  ORDER BY avg_salary DESC;
`).all();
console.table(avgSalaries);

db.close();
console.log('Database connection closed.');
