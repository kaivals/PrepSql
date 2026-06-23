import sqlite3
import psycopg2
import pymysql
from typing import Dict, List, Any, Optional
from database import get_or_create_pool, get_sqlite_lock

def quote_pg_identifier(name: str) -> str:
    return f'"{name.replace("\"", "\"\"")}"'

def introspect_schema(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    db_type = config.get("type")
    pool = get_or_create_pool(config)

    if db_type == "sqlite":
        return introspect_sqlite(pool)
    elif db_type == "postgresql":
        return introspect_postgresql(pool)
    elif db_type in ("mysql", "mariadb"):
        return introspect_mysql(pool)
    else:
        raise ValueError(f"Unsupported database type: {db_type}")

def introspect_sqlite(filepath: str) -> List[Dict[str, Any]]:
    lock = get_sqlite_lock(filepath)
    with lock:
        conn = sqlite3.connect(filepath)
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.cursor()
            
            # Fetch all tables
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            tables = [row["name"] for row in cursor.fetchall()]
            
            result = []
            for table_name in tables:
                # Fetch columns info
                cursor.execute(f'PRAGMA table_info("{table_name}")')
                columns_rows = cursor.fetchall()
                
                # Fetch foreign keys
                cursor.execute(f'PRAGMA foreign_key_list("{table_name}")')
                fk_rows = cursor.fetchall()
                fk_map = {}
                for fk in fk_rows:
                    # fk fields: id, seq, table, from, to, on_update, on_delete, match
                    fk_map[fk["from"]] = {"table": fk["table"], "column": fk["to"]}
                
                # Fetch index list
                cursor.execute(f'PRAGMA index_list("{table_name}")')
                idx_rows = cursor.fetchall()
                
                unique_cols = set()
                index_names = []
                for idx in idx_rows:
                    index_names.append(idx["name"])
                    if idx["unique"] == 1:
                        cursor.execute(f'PRAGMA index_info("{idx["name"]}")')
                        for col in cursor.fetchall():
                            unique_cols.add(col["name"])
                
                # Fetch creation SQL to detect AUTOINCREMENT
                cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
                sql_row = cursor.fetchone()
                table_sql = (sql_row["sql"] or "").lower() if sql_row else ""
                
                # Fetch row count
                cursor.execute(f'SELECT COUNT(*) as count FROM "{table_name}"')
                count_row = cursor.fetchone()
                row_count = count_row["count"] if count_row else 0
                
                columns = []
                for c in columns_rows:
                    is_pk = c["pk"] > 0
                    is_auto = is_pk and "autoincrement" in table_sql
                    columns.append({
                        "name": c["name"],
                        "type": c["type"],
                        "nullable": c["notnull"] == 0,
                        "defaultValue": c["dflt_value"],
                        "primaryKey": is_pk,
                        "unique": c["name"] in unique_cols,
                        "autoIncrement": is_auto,
                        "foreignKey": fk_map.get(c["name"])
                    })
                
                result.append({
                    "name": table_name,
                    "columns": columns,
                    "rowCount": row_count,
                    "indexes": index_names
                })
            
            return result
        finally:
            conn.close()

def introspect_postgresql(pool: Any) -> List[Dict[str, Any]]:
    # pool is ThreadedConnectionPool
    conn = pool.getconn()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Get all public tables
        cursor.execute("""
            SELECT c.relname AS table_name
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
            ORDER BY c.relname
        """)
        tables = [row["table_name"] for row in cursor.fetchall()]
        
        result = []
        for table_name in tables:
            # Columns query preserving case
            cursor.execute("""
                SELECT
                    a.attname                                        AS column_name,
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                    NOT a.attnotnull                                 AS is_nullable,
                    pg_catalog.pg_get_expr(d.adbin, d.adrelid)      AS column_default,
                    EXISTS (
                      SELECT 1 FROM pg_catalog.pg_index ix
                      JOIN pg_catalog.pg_attribute ia
                        ON ia.attrelid = ix.indrelid AND ia.attnum = ANY(ix.indkey)
                      WHERE ix.indrelid = a.attrelid
                        AND ia.attnum    = a.attnum
                        AND ix.indisprimary
                    ) AS is_primary,
                    EXISTS (
                      SELECT 1 FROM pg_catalog.pg_index ix
                      JOIN pg_catalog.pg_attribute ia
                        ON ia.attrelid = ix.indrelid AND ia.attnum = ANY(ix.indkey)
                      WHERE ix.indrelid = a.attrelid
                        AND ia.attnum    = a.attnum
                        AND ix.indisunique
                        AND NOT ix.indisprimary
                    ) AS is_unique,
                    (
                      pg_catalog.pg_get_expr(d.adbin, d.adrelid) ILIKE 'nextval(%'
                      OR a.attidentity != ''
                    ) AS is_identity
                 FROM pg_catalog.pg_attribute a
                 JOIN pg_catalog.pg_class     cl ON cl.oid = a.attrelid
                 JOIN pg_catalog.pg_namespace n  ON n.oid  = cl.relnamespace
                 LEFT JOIN pg_catalog.pg_attrdef d
                   ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE n.nspname  = 'public'
                   AND cl.relname = %s
                   AND a.attnum   > 0
                   AND NOT a.attisdropped
                 ORDER BY a.attnum
            """, (table_name,))
            columns_rows = cursor.fetchall()
            
            # Foreign keys query
            cursor.execute("""
                SELECT
                    kcu.column_name,
                    ccu.table_name  AS foreign_table,
                    ccu.column_name AS foreign_column
                FROM information_schema.table_constraints   tc
                JOIN information_schema.key_column_usage    kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema    = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema    = 'public'
                  AND tc.table_name      = %s
            """, (table_name,))
            fk_rows = cursor.fetchall()
            fk_map = {}
            for fk in fk_rows:
                fk_map[fk["column_name"]] = {"table": fk["foreign_table"], "column": fk["foreign_column"]}
            
            # Indexes query
            cursor.execute("""
                SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = %s
            """, (table_name,))
            index_names = [row["indexname"] for row in cursor.fetchall()]
            
            # Row count query
            quoted_table = quote_pg_identifier(table_name)
            cursor.execute(f"SELECT COUNT(*)::int AS count FROM {quoted_table}")
            count_row = cursor.fetchone()
            row_count = count_row["count"] if count_row else 0
            
            columns = []
            for c in columns_rows:
                columns.append({
                    "name": c["column_name"],
                    "type": c["data_type"],
                    "nullable": c["is_nullable"],
                    "defaultValue": c["column_default"],
                    "primaryKey": c["is_primary"],
                    "unique": c["is_unique"],
                    "autoIncrement": c["is_identity"],
                    "foreignKey": fk_map.get(c["column_name"])
                })
                
            result.append({
                "name": table_name,
                "columns": columns,
                "rowCount": row_count,
                "indexes": index_names
            })
            
        return result
    finally:
        pool.putconn(conn)

def introspect_mysql(pool: Any) -> List[Dict[str, Any]]:
    # pool is MySQLPool
    conn = pool.get_connection()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # Get all tables
        cursor.execute("SHOW TABLES")
        tables_rows = cursor.fetchall()
        if not tables_rows:
            return []
            
        table_key = list(tables_rows[0].keys())[0]
        tables = [row[table_key] for row in tables_rows]
        
        result = []
        for table_name in tables:
            # Columns query
            cursor.execute("""
                SELECT 
                    COLUMN_NAME, 
                    DATA_TYPE, 
                    IS_NULLABLE, 
                    COLUMN_DEFAULT, 
                    COLUMN_KEY, 
                    EXTRA
                 FROM information_schema.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
                 ORDER BY ORDINAL_POSITION
            """, (table_name,))
            columns_rows = cursor.fetchall()
            
            # Foreign keys query
            cursor.execute("""
                SELECT 
                    COLUMN_NAME, 
                    REFERENCED_TABLE_NAME AS foreign_table, 
                    REFERENCED_COLUMN_NAME AS foreign_column
                 FROM information_schema.KEY_COLUMN_USAGE 
                 WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = %s 
                    AND REFERENCED_TABLE_NAME IS NOT NULL
            """, (table_name,))
            fk_rows = cursor.fetchall()
            fk_map = {}
            for fk in fk_rows:
                fk_map[fk["COLUMN_NAME"]] = {"table": fk["foreign_table"], "column": fk["foreign_column"]}
                
            # Row count
            cursor.execute(f"SELECT COUNT(*) as count FROM `{table_name}`")
            count_row = cursor.fetchone()
            row_count = int(count_row["count"]) if count_row else 0
            
            # Indexes
            cursor.execute(f"SHOW INDEX FROM `{table_name}`")
            index_rows = cursor.fetchall()
            index_names = list(set([row["Key_name"] for row in index_rows]))
            
            columns = []
            for c in columns_rows:
                columns.append({
                    "name": c["COLUMN_NAME"],
                    "type": c["DATA_TYPE"],
                    "nullable": c["IS_NULLABLE"] == 'YES',
                    "defaultValue": c["COLUMN_DEFAULT"],
                    "primaryKey": c["COLUMN_KEY"] == 'PRI',
                    "unique": c["COLUMN_KEY"] == 'UNI',
                    "autoIncrement": 'auto_increment' in c["EXTRA"],
                    "foreignKey": fk_map.get(c["COLUMN_NAME"])
                })
                
            result.append({
                "name": table_name,
                "columns": columns,
                "rowCount": row_count,
                "indexes": index_names
            })
            
        return result
    finally:
        pool.put_connection(conn)
