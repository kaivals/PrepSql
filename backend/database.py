import os
import sqlite3
import threading
import queue
from typing import Dict, List, Any, Optional, Tuple
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
import psycopg2.extras
import pymysql
import pymysql.cursors

# Cache for connection pools
pools_cache = {}
pools_lock = threading.Lock()

# Thread locks for SQLite file access
sqlite_locks = {}
sqlite_locks_lock = threading.Lock()

def get_sqlite_lock(filepath: str) -> threading.Lock:
    with sqlite_locks_lock:
        if filepath not in sqlite_locks:
            sqlite_locks[filepath] = threading.Lock()
        return sqlite_locks[filepath]

class MySQLPool:
    def __init__(self, minconn: int = 1, maxconn: int = 5, **kwargs):
        self.kwargs = kwargs
        self.maxconn = maxconn
        self.pool = queue.Queue(maxsize=maxconn)
        self.active_connections = 0
        self.lock = threading.Lock()
        
        for _ in range(minconn):
            conn = pymysql.connect(**self.kwargs)
            self.pool.put(conn)
            self.active_connections += 1

    def get_connection(self):
        with self.lock:
            # Try to get from queue
            try:
                conn = self.pool.get(block=False)
                try:
                    conn.ping(reconnect=True)
                except Exception:
                    conn = pymysql.connect(**self.kwargs)
                return conn
            except queue.Empty:
                # If we haven't reached max, create new one
                if self.active_connections < self.maxconn:
                    conn = pymysql.connect(**self.kwargs)
                    self.active_connections += 1
                    return conn
                else:
                    # Block until one becomes available
                    conn = self.pool.get(block=True, timeout=10)
                    try:
                        conn.ping(reconnect=True)
                    except Exception:
                        conn = pymysql.connect(**self.kwargs)
                    return conn

    def put_connection(self, conn):
        try:
            self.pool.put(conn, block=False)
        except queue.Full:
            conn.close()
            with self.lock:
                self.active_connections -= 1

    def close(self):
        with self.lock:
            while not self.pool.empty():
                try:
                    conn = self.pool.get(block=False)
                    conn.close()
                except queue.Empty:
                    break
            self.active_connections = 0

def get_pool_key(config: Dict[str, Any]) -> str:
    db_type = config.get("type")
    if db_type == "sqlite":
        return f"sqlite:{config.get('filepath')}"
    return f"{db_type}:{config.get('host')}:{config.get('port')}:{config.get('database')}"

def get_or_create_pool(config: Dict[str, Any]) -> Any:
    key = get_pool_key(config)
    with pools_lock:
        if key in pools_cache:
            return pools_cache[key]

        db_type = config.get("type")
        if db_type == "sqlite":
            # For SQLite we just return the filepath since we connect/disconnect on demand
            pools_cache[key] = config.get("filepath")
            return pools_cache[key]
        elif db_type == "postgresql":
            port = int(config.get("port") or 5432)
            pool = ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                host=config.get("host"),
                port=port,
                user=config.get("user"),
                password=config.get("password") or "",
                database=config.get("database")
            )
            pools_cache[key] = pool
            return pool
        elif db_type in ("mysql", "mariadb"):
            port = int(config.get("port") or 3306)
            pool = MySQLPool(
                minconn=1,
                maxconn=5,
                host=config.get("host"),
                port=port,
                user=config.get("user"),
                password=config.get("password") or "",
                database=config.get("database")
            )
            pools_cache[key] = pool
            return pool
        else:
            raise ValueError(f"Unsupported database type: {db_type}")

def test_connection(config: Dict[str, Any]) -> bool:
    db_type = config.get("type")
    if db_type == "sqlite":
        filepath = config.get("filepath")
        if not filepath:
            raise ValueError("Filepath required for SQLite")
        # Ensure directory exists
        if filepath != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        conn = sqlite3.connect(filepath)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            return True
        finally:
            conn.close()
    elif db_type == "postgresql":
        port = int(config.get("port") or 5432)
        conn = psycopg2.connect(
            host=config.get("host"),
            port=port,
            user=config.get("user"),
            password=config.get("password") or "",
            database=config.get("database")
        )
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            return True
        finally:
            conn.close()
    elif db_type in ("mysql", "mariadb"):
        port = int(config.get("port") or 3306)
        conn = pymysql.connect(
            host=config.get("host"),
            port=port,
            user=config.get("user"),
            password=config.get("password") or "",
            database=config.get("database")
        )
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            return True
        finally:
            conn.close()
    else:
        raise ValueError(f"Unsupported database type: {db_type}")

def execute_query(config: Dict[str, Any], sql: str) -> Dict[str, Any]:
    db_type = config.get("type")
    pool = get_or_create_pool(config)

    if db_type == "sqlite":
        filepath = pool  # pool holds the filepath for SQLite
        lock = get_sqlite_lock(filepath)
        with lock:
            conn = sqlite3.connect(filepath)
            conn.row_factory = sqlite3.Row
            try:
                cursor = conn.cursor()
                cursor.execute(sql)
                
                # Check if it returns rows (SELECT, PRAGMA, etc.)
                description = cursor.description
                if description:
                    columns = [col[0] for col in description]
                    rows = [dict(row) for row in cursor.fetchall()]
                    conn.commit()
                    return {
                        "columns": columns,
                        "rows": rows,
                        "rowsAffected": len(rows)
                    }
                else:
                    conn.commit()
                    return {
                        "columns": [],
                        "rows": [],
                        "rowsAffected": cursor.rowcount if cursor.rowcount != -1 else 0
                    }
            except Exception as e:
                conn.rollback()
                raise e
            finally:
                conn.close()

    elif db_type == "postgresql":
        # pool is ThreadedConnectionPool
        conn = pool.getconn()
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute(sql)
            
            description = cursor.description
            if description:
                columns = [col.name for col in description]
                # convert RealDictRow to regular dict
                rows = [dict(row) for row in cursor.fetchall()]
                conn.commit()
                return {
                    "columns": columns,
                    "rows": rows,
                    "rowsAffected": cursor.rowcount if cursor.rowcount != -1 else 0
                }
            else:
                conn.commit()
                return {
                    "columns": [],
                    "rows": [],
                    "rowsAffected": cursor.rowcount if cursor.rowcount != -1 else 0
                }
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            pool.putconn(conn)

    elif db_type in ("mysql", "mariadb"):
        # pool is MySQLPool
        conn = pool.get_connection()
        try:
            # pymysql DictCursor
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(sql)
            
            description = cursor.description
            if description:
                columns = [col[0] for col in description]
                rows = list(cursor.fetchall())
                conn.commit()
                return {
                    "columns": columns,
                    "rows": rows,
                    "rowsAffected": cursor.rowcount if cursor.rowcount != -1 else 0
                }
            else:
                conn.commit()
                return {
                    "columns": [],
                    "rows": [],
                    "rowsAffected": cursor.rowcount if cursor.rowcount != -1 else 0
                }
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            pool.put_connection(conn)

    else:
        raise ValueError(f"Unsupported database type: {db_type}")


def get_demo_db_path() -> str:
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, 'data.db')


def ensure_demo_database() -> str:
    db_path = get_demo_db_path()
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")
        
        # Create departments
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS departments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                budget REAL NOT NULL,
                location TEXT NOT NULL,
                manager_id INTEGER,
                FOREIGN KEY(manager_id) REFERENCES employees(id) ON DELETE SET NULL
            );
        """)
        
        # Create employees
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS employees (
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
        """)
        
        # Create projects
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                start_date DATE NOT NULL,
                end_date DATE,
                budget REAL NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('Planning', 'Active', 'Completed', 'On Hold'))
            );
        """)
        
        # Create employee_projects
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS employee_projects (
                employee_id INTEGER,
                project_id INTEGER,
                role TEXT NOT NULL,
                hours_per_week INTEGER DEFAULT 40,
                PRIMARY KEY (employee_id, project_id),
                FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
        """)
        
        # Create performance_reviews
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS performance_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL,
                reviewer_id INTEGER NOT NULL,
                review_date DATE NOT NULL,
                score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
                feedback TEXT,
                FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                FOREIGN KEY(reviewer_id) REFERENCES employees(id) ON DELETE CASCADE
            );
        """)
        conn.commit()

        # Check if we already have data
        cursor.execute("SELECT COUNT(*) FROM departments")
        if cursor.fetchone()[0] == 0:
            # Seed departments
            depts = [
                ('Executive', 1000000.00, 'San Francisco'),
                ('Engineering', 2500000.00, 'San Francisco'),
                ('Marketing', 800000.00, 'New York'),
                ('Sales', 1200000.00, 'Chicago'),
                ('Human Resources', 3500000.00, 'Austin'),
                ('Finance', 900000.00, 'New York')
            ]
            cursor.executemany("INSERT INTO departments (name, budget, location, manager_id) VALUES (?, ?, ?, NULL)", depts)
            conn.commit()
            
            # Map of department names to database IDs
            cursor.execute("SELECT name, id FROM departments")
            dept_ids = {row[0]: row[1] for row in cursor.fetchall()}

            # Insert Alice Vance (CEO, reports to none)
            cursor.execute(
                "INSERT INTO employees (first_name, last_name, email, phone, hire_date, job_title, salary, department_id, manager_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ('Alice', 'Vance', 'alice.vance@company.com', '555-0100', '2020-01-15', 'Chief Executive Officer', 280000.00, dept_ids['Executive'], None)
            )
            ceo_id = cursor.lastrowid

            # Insert Department Heads (who report to CEO)
            managers = [
                ('Bob', 'Miller', 'bob.miller@company.com', '555-0101', '2020-03-10', 'VP of Engineering', 185000.00, 'Engineering'),
                ('Carol', 'Davis', 'carol.davis@company.com', '555-0102', '2020-05-12', 'Marketing Director', 135000.00, 'Marketing'),
                ('David', 'Wilson', 'david.wilson@company.com', '555-0103', '2020-06-01', 'VP of Sales', 145000.00, 'Sales'),
                ('Emma', 'Taylor', 'emma.taylor@company.com', '555-0104', '2021-02-15', 'HR Director', 110000.00, 'Human Resources'),
                ('Frank', 'Thomas', 'frank.thomas@company.com', '555-0105', '2020-11-01', 'Chief Financial Officer', 195000.00, 'Finance')
            ]
            
            manager_ids = {}
            for first, last, email, phone, hire, title, salary, dept_name in managers:
                cursor.execute(
                    "INSERT INTO employees (first_name, last_name, email, phone, hire_date, job_title, salary, department_id, manager_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (first, last, email, phone, hire, title, salary, dept_ids[dept_name], ceo_id)
                )
                manager_ids[dept_name] = cursor.lastrowid
                
            # Update department managers
            cursor.execute("UPDATE departments SET manager_id = ? WHERE id = ?", (ceo_id, dept_ids['Executive']))
            for dept_name, mgr_id in manager_ids.items():
                cursor.execute("UPDATE departments SET manager_id = ? WHERE id = ?", (mgr_id, dept_ids[dept_name]))
            conn.commit()

            # Staff
            staff = [
                # Engineering Reports to Bob Miller (manager_ids['Engineering'])
                ('Grace', 'Hopper', 'grace.hopper@company.com', '555-0201', '2021-06-01', 'Principal Software Engineer', 160000.00, 'Engineering', 'Engineering'),
                ('Alan', 'Turing', 'alan.turing@company.com', '555-0202', '2021-07-15', 'Senior Software Engineer', 135000.00, 'Engineering', 'Engineering'),
                ('Ada', 'Lovelace', 'ada.lovelace@company.com', '555-0203', '2022-01-10', 'Software Engineer II', 105000.00, 'Engineering', 'Engineering'),
                ('Margaret', 'Hamilton', 'margaret.hamilton@company.com', '555-0204', '2022-03-22', 'Senior DevOps Engineer', 140000.00, 'Engineering', 'Engineering'),
                ('Linus', 'Torvalds', 'linus.torvalds@company.com', '555-0205', '2022-05-18', 'Kernel Engineer', 150000.00, 'Engineering', 'Engineering'),
                ('Ken', 'Thompson', 'ken.thompson@company.com', '555-0206', '2022-09-01', 'Software Engineer II', 110000.00, 'Engineering', 'Engineering'),
                ('Dennis', 'Ritchie', 'dennis.ritchie@company.com', '555-0207', '2022-09-01', 'Systems Architect', 155000.00, 'Engineering', 'Engineering'),
                ('Guido', 'van Rossum', 'guido.vanrossum@company.com', '555-0208', '2023-02-01', 'Software Engineer I', 90000.00, 'Engineering', 'Engineering'),
                ('Yukihiro', 'Matsumoto', 'matz@company.com', '555-0209', '2023-06-15', 'Software Engineer I', 92000.00, 'Engineering', 'Engineering'),
                ('Tim', 'Berners-Lee', 'tim.bl@company.com', '555-0210', '2023-11-10', 'Web Developer', 88000.00, 'Engineering', 'Engineering'),

                # Marketing Reports to Carol Davis (manager_ids['Marketing'])
                ('Helen', 'Keller', 'helen.keller@company.com', '555-0301', '2021-08-01', 'Content Manager', 75000.00, 'Marketing', 'Marketing'),
                ('Maya', 'Angelou', 'maya.angelou@company.com', '555-0302', '2022-02-14', 'Copywriter', 65000.00, 'Marketing', 'Marketing'),
                ('George', 'Orwell', 'george.orwell@company.com', '555-0303', '2022-08-01', 'SEO Specialist', 70000.00, 'Marketing', 'Marketing'),
                ('Virginia', 'Woolf', 'virginia.woolf@company.com', '555-0304', '2023-01-20', 'Social Media Manager', 68000.00, 'Marketing', 'Marketing'),

                # Sales Reports to David Wilson (manager_ids['Sales'])
                ('James', 'Smith', 'james.smith@company.com', '555-0401', '2021-03-01', 'Account Executive', 85000.00, 'Sales', 'Sales'),
                ('Mary', 'Johnson', 'mary.johnson@company.com', '555-0402', '2021-09-10', 'Senior Account Executive', 95000.00, 'Sales', 'Sales'),
                ('John', 'Williams', 'john.williams@company.com', '555-0403', '2022-04-05', 'Sales Representative', 60000.00, 'Sales', 'Sales'),
                ('Patricia', 'Brown', 'patricia.brown@company.com', '555-0404', '2022-11-12', 'Sales Representative', 62000.00, 'Sales', 'Sales'),
                ('Robert', 'Jones', 'robert.jones@company.com', '555-0405', '2023-05-01', 'Account Manager', 78000.00, 'Sales', 'Sales'),

                # HR Reports to Emma Taylor (manager_ids['Human Resources'])
                ('Linda', 'Garcia', 'linda.garcia@company.com', '555-0501', '2021-10-01', 'HR Generalist', 72000.00, 'Human Resources', 'Human Resources'),
                ('Michael', 'Martinez', 'michael.martinez@company.com', '555-0502', '2022-07-19', 'Recruiting Coordinator', 64000.00, 'Human Resources', 'Human Resources'),
                ('Elizabeth', 'Robinson', 'elizabeth.robinson@company.com', '555-0503', '2023-04-10', 'Benefits Specialist', 70000.00, 'Human Resources', 'Human Resources'),

                # Finance Reports to Frank Thomas (manager_ids['Finance'])
                ('William', 'Clark', 'william.clark@company.com', '555-0601', '2021-04-18', 'Senior Accountant', 92000.00, 'Finance', 'Finance'),
                ('Barbara', 'Rodriguez', 'barbara.rodriguez@company.com', '555-0602', '2022-05-05', 'Financial Analyst', 80000.00, 'Finance', 'Finance'),
                ('Richard', 'Lewis', 'richard.lewis@company.com', '555-0603', '2023-03-01', 'Accounts Payable Clerk', 58000.00, 'Finance', 'Finance')
            ]

            employee_ids = {'Alice Vance': ceo_id}
            employee_ids['Bob Miller'] = manager_ids['Engineering']
            employee_ids['Carol Davis'] = manager_ids['Marketing']
            employee_ids['David Wilson'] = manager_ids['Sales']
            employee_ids['Emma Taylor'] = manager_ids['Human Resources']
            employee_ids['Frank Thomas'] = manager_ids['Finance']

            for first, last, email, phone, hire, title, salary, dept_name, mgr_dept in staff:
                mgr_id = manager_ids[mgr_dept]
                cursor.execute(
                    "INSERT INTO employees (first_name, last_name, email, phone, hire_date, job_title, salary, department_id, manager_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (first, last, email, phone, hire, title, salary, dept_ids[dept_name], mgr_id)
                )
                employee_ids[f"{first} {last}"] = cursor.lastrowid
            conn.commit()

            # Projects
            projects = [
                ('Project Alpha', 'Next generation e-commerce backend platform migration.', '2025-01-10', '2025-12-20', 500000.00, 'Completed'),
                ('Project Beta', 'Customer data integration and compliance framework.', '2025-03-15', '2026-02-28', 350000.00, 'Completed'),
                ('Project Gamma', 'AI-powered predictive sales forecasting assistant tool.', '2026-01-05', None, 750000.00, 'Active'),
                ('Project Delta', 'Mobile application redesign for iOS and Android platforms.', '2026-03-01', None, 450000.00, 'Active'),
                ('Project Epsilon', 'Global market campaign for new product line launch.', '2026-05-01', '2026-11-30', 200000.00, 'Active'),
                ('Project Zeta', 'Infrastructure server consolidation and cloud cost optimization.', '2026-07-01', None, 150000.00, 'Planning'),
                ('Project Eta', 'Corporate HR talent recruitment portal revamp.', '2026-02-10', None, 120000.00, 'On Hold')
            ]
            project_ids = {}
            for name, desc, start, end, budget, status in projects:
                cursor.execute(
                    "INSERT INTO projects (name, description, start_date, end_date, budget, status) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, desc, start, end, budget, status)
                )
                project_ids[name] = cursor.lastrowid
            conn.commit()

            # Assignments
            assignments = [
                ('Bob Miller', 'Project Alpha', 'Project Sponsor', 5),
                ('Grace Hopper', 'Project Alpha', 'Technical Lead', 35),
                ('Ada Lovelace', 'Project Alpha', 'Developer', 40),
                ('Linus Torvalds', 'Project Alpha', 'Kernel Integration Engineer', 20),
                ('Dennis Ritchie', 'Project Alpha', 'Systems Engineer', 30),
                ('Helen Keller', 'Project Alpha', 'Documentation lead', 10),
                
                ('Carol Davis', 'Project Beta', 'Project Owner', 10),
                ('Margaret Hamilton', 'Project Beta', 'DevOps Lead', 35),
                ('Ken Thompson', 'Project Beta', 'Backend Developer', 40),
                ('William Clark', 'Project Beta', 'Financial Compliance Auditor', 15),
                
                ('Bob Miller', 'Project Gamma', 'Project Sponsor', 8),
                ('Alan Turing', 'Project Gamma', 'AI Lead Researcher', 40),
                ('Grace Hopper', 'Project Gamma', 'Architect', 20),
                ('Guido van Rossum', 'Project Gamma', 'Developer (Python)', 40),
                ('Yukihiro Matsumoto', 'Project Gamma', 'Developer (Ruby/APIs)', 30),
                ('Mary Johnson', 'Project Gamma', 'Sales Liaison', 10),
                
                ('Bob Miller', 'Project Delta', 'Project Sponsor', 5),
                ('Tim Berners-Lee', 'Project Delta', 'Frontend Lead', 40),
                ('Ada Lovelace', 'Project Delta', 'Mobile Developer', 30),
                ('Virginia Woolf', 'Project Delta', 'UI/UX Coordinator', 25),
                ('Helen Keller', 'Project Delta', 'Marketing Representative', 15),
                
                ('Carol Davis', 'Project Epsilon', 'Campaign Lead', 30),
                ('Helen Keller', 'Project Epsilon', 'Content Strategy Manager', 20),
                ('Maya Angelou', 'Project Epsilon', 'Copywriter', 40),
                ('George Orwell', 'Project Epsilon', 'SEO Lead', 35),
                ('Virginia Woolf', 'Project Epsilon', 'Social Coordinator', 20),
                ('James Smith', 'Project Epsilon', 'Sales Lead', 15),
                
                ('Margaret Hamilton', 'Project Zeta', 'Infrastructure Lead', 10),
                ('Linus Torvalds', 'Project Zeta', 'Advisor', 5),
                ('Dennis Ritchie', 'Project Zeta', 'Consultant', 5),
                ('Barbara Rodriguez', 'Project Zeta', 'Budget Controller', 8),
                
                ('Emma Taylor', 'Project Eta', 'Project Sponsor', 2),
                ('Linda Garcia', 'Project Eta', 'HR Coordinator', 10),
                ('Michael Martinez', 'Project Eta', 'Recruiting Auditor', 10)
            ]
            for emp_name, proj_name, role, hours in assignments:
                e_id = employee_ids.get(emp_name)
                p_id = project_ids.get(proj_name)
                if e_id and p_id:
                    cursor.execute(
                        "INSERT INTO employee_projects (employee_id, project_id, role, hours_per_week) VALUES (?, ?, ?, ?)",
                        (e_id, p_id, role, hours)
                    )
            conn.commit()

            # Reviews
            reviews = [
                ('Bob Miller', 'Alice Vance', '2025-12-15', 5, 'Bob has done an outstanding job leading the engineering department. Completed both Project Alpha and Beta successfully.'),
                ('Carol Davis', 'Alice Vance', '2025-12-16', 4, 'Carol led the marketing team to hit all major user acquisition targets. Excellent work on Project Beta campaign.'),
                ('David Wilson', 'Alice Vance', '2025-12-17', 4, 'David restructured sales divisions and hit global revenue goals. Needs to focus slightly more on integration with tech projects.'),
                ('Frank Thomas', 'Alice Vance', '2025-12-18', 5, 'Frank has maintained impeccable financial controls, keeping general department budgets well within limits.'),
                
                ('Grace Hopper', 'Bob Miller', '2025-11-20', 5, 'Grace is an invaluable asset. Her leadership on Project Alpha architecture was exceptional. Shows deep technical expertise.'),
                ('Alan Turing', 'Bob Miller', '2025-11-21', 5, 'Alan is leading our AI initiatives brilliantly on Project Gamma. His research is state of the art.'),
                ('Ada Lovelace', 'Bob Miller', '2025-11-22', 4, 'Ada contributed major feature additions to Project Alpha. Outstanding programming skills, occasionally needs to align on timeline estimates.'),
                ('Margaret Hamilton', 'Bob Miller', '2025-11-23', 5, "Margaret's infrastructure setup saved us from major downtime during the transition. Absolute professional."),
                ('Linus Torvalds', 'Bob Miller', '2025-11-24', 4, 'Linus produces extremely high-quality code. Code reviews are strict but highly constructive.'),
                ('Tim Berners-Lee', 'Bob Miller', '2026-05-10', 4, 'Tim is doing a great job leading the frontend transition. Highly responsive to design feedback.'),
                ('Guido van Rossum', 'Bob Miller', '2026-05-11', 4, 'Guido has been coding very clean, readable APIs for the sales predictor assistant.'),
                
                ('Helen Keller', 'Carol Davis', '2025-12-05', 4, 'Helen has managed Content extremely well and coordinated across multiple projects seamlessly.'),
                ('Maya Angelou', 'Carol Davis', '2025-12-06', 5, "Maya's copies are outstanding and have driven a 20% increase in ad engagement rates."),
                ('George Orwell', 'Carol Davis', '2025-12-07', 3, 'George does great SEO work but needs to improve collaboration with the broader marketing team.'),
                
                ('Mary Johnson', 'David Wilson', '2025-12-10', 5, 'Mary is our top account executive. Exceeded quota by 35% in Q3 and Q4. Promoted to Senior.'),
                ('James Smith', 'David Wilson', '2025-12-11', 4, 'James shows great drive. Solid sales numbers and strong customer relationship building.'),
                
                ('Linda Garcia', 'Emma Taylor', '2025-12-12', 4, 'Linda handles employee relations very professionally and has streamlined the onboarding process.')
            ]
            for emp_name, rev_name, r_date, score, feedback in reviews:
                e_id = employee_ids.get(emp_name)
                r_id = employee_ids.get(rev_name)
                if e_id and r_id:
                    cursor.execute(
                        "INSERT INTO performance_reviews (employee_id, reviewer_id, review_date, score, feedback) VALUES (?, ?, ?, ?, ?)",
                        (e_id, r_id, r_date, score, feedback)
                    )
            conn.commit()
    finally:
        conn.close()
    return db_path
