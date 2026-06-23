from typing import List, Dict, Any
from schema import quote_pg_identifier

def format_schema_for_prompt(tables: List[Dict[str, Any]], db_type: str) -> str:
    if not tables:
        return 'No tables found in schema.'

    is_pg = db_type == 'postgresql'
    lines = []

    for table in tables:
        tname = table.get("name", "")
        tref = quote_pg_identifier(tname) if is_pg else tname

        cols = []
        for c in table.get("columns", []):
            cname = c.get("name", "")
            cref = quote_pg_identifier(cname) if is_pg else cname
            ctype = c.get("type", "")
            
            flags = []
            if c.get("primaryKey"):
                flags.append('PK')
            if c.get("autoIncrement"):
                flags.append('auto')
            if not c.get("nullable"):
                flags.append('NOT NULL')
            if c.get("unique") and not c.get("primaryKey"):
                flags.append('UNIQUE')
            
            fk = c.get("foreignKey")
            if fk:
                fk_table = quote_pg_identifier(fk.get("table")) if is_pg else fk.get("table")
                fk_col = quote_pg_identifier(fk.get("column")) if is_pg else fk.get("column")
                flags.append(f'FK→{fk_table}.{fk_col}')
                
            flag_str = f" [{', '.join(flags)}]" if flags else ""
            cols.append(f"  - {cref} ({ctype}){flag_str}")
            
        cols_str = "\n".join(cols)
        row_count = table.get("rowCount", 0)
        lines.append(f"Table {tref} ({row_count} rows):\n{cols_str}")

    pg_note = (
        "\n\nCRITICAL POSTGRESQL RULE: Every table name and column name shown above is already wrapped in double-quotes. "
        "You MUST copy them VERBATIM into your SQL — including the double-quotes. Never lowercase, never remove quotes. "
        "Example: SELECT \"userId\", \"createdAt\" FROM \"Users\" WHERE \"isActive\" = true"
        if is_pg else ""
    )

    return f"Database schema (exact identifier casing — do NOT alter):\n\n{'\n\n'.join(lines)}{pg_note}"

def build_select_preview(table: Dict[str, Any], db_type: str, limit: int = 10) -> str:
    tname = table.get("name", "")
    tref = quote_pg_identifier(tname) if db_type == 'postgresql' else tname
    return f"SELECT * FROM {tref} LIMIT {limit}"
