import re
from typing import Dict, List, Set, Tuple, Any

def quote_pg_identifier(name: str) -> str:
    return f'"{name.replace("\"", "\"\"")}"'

# SQL keywords that must never be rewritten as identifiers
SQL_KEYWORDS = {
    'select','from','where','join','on','and','or','not','in','is','null',
    'true','false','as','order','by','group','having','limit','offset',
    'insert','into','values','update','set','delete','create','alter','drop',
    'table','column','index','unique','primary','key','foreign','references',
    'inner','left','right','full','outer','cross','natural','using',
    'with','recursive','union','all','except','intersect','exists','between',
    'like','ilike','similar','case','when','then','else','end','cast','coalesce',
    'nullif','extract','date','time','timestamp','interval','returning',
    'distinct','count','sum','avg','min','max','asc','desc','nulls','first','last',
    'over','partition','rows','range','unbounded','preceding','following','current',
    'row','filter','within','int','integer','text','varchar','boolean',
    'numeric','decimal','float','double','precision','char','serial','bigserial',
    'smallint','bigint','real','json','jsonb','uuid','bytea','money','bit',
    'do','begin','commit','rollback','savepoint','language','plpgsql',
    'perform','raise','notice','exception','return','returns','function',
    'procedure','trigger','view','materialized','refresh','concurrently',
    'explain','analyze','verbose','buffers','format','public','schema',
    'default','constraint','check','deferrable','initially','deferred',
    'immediate','no','action','restrict','cascade','set','match','simple',
    'full','partial','always','generated','identity','sequence','owned',
    'nextval','currval','setval','now','current_timestamp','current_date',
    'current_time','localtime','localtimestamp','at','zone','epoch','year',
    'month','day','hour','minute','second','microseconds','milliseconds',
}

def build_schema_maps(tables: List[Dict[str, Any]]) -> Tuple[Dict[str, str], Dict[str, str], Dict[str, Dict[str, str]]]:
    table_map = {}
    column_map = {}
    columns_by_table = {}

    for table in tables:
        tname = table.get("name", "")
        tname_lower = tname.lower()
        table_map[tname_lower] = tname
        
        col_map = {}
        for col in table.get("columns", []):
            cname = col.get("name", "")
            cname_lower = cname.lower()
            column_map[cname_lower] = cname
            col_map[cname_lower] = cname
            
        columns_by_table[tname_lower] = col_map

    return table_map, column_map, columns_by_table

def validate_and_correct_sql(
    sql: str,
    tables: List[Dict[str, Any]],
    db_type: str
) -> Dict[str, Any]:
    if not tables or db_type == 'sqlite':
        # SQLite is case-insensitive natively — no correction needed.
        return {
            "correctedSql": sql,
            "corrections": [],
            "unmatchedIdentifiers": []
        }

    is_pg = db_type == 'postgresql'
    table_map, column_map, _ = build_schema_maps(tables)

    corrections = []
    unmatched_set = set()
    corrected = ''
    i = 0
    sql_len = len(sql)

    while i < sql_len:
        ch = sql[i]

        # Double-quoted identifier -> already quoted, pass through
        if ch == '"':
            j = i + 1
            while j < sql_len:
                if sql[j] == '"':
                    if j + 1 < sql_len and sql[j + 1] == '"':
                        j += 2
                        continue  # escaped quote
                    j += 1
                    break
                j += 1
            corrected += sql[i:j]
            i = j
            continue

        # Single-quoted string literal -> pass through
        if ch == "'":
            j = i + 1
            while j < sql_len:
                if sql[j] == "'":
                    if j + 1 < sql_len and sql[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            corrected += sql[i:j]
            i = j
            continue

        # Backtick-quoted identifier (MySQL) -> pass through
        if ch == '`':
            j = i + 1
            while j < sql_len and sql[j] != '`':
                j += 1
            corrected += sql[i:j + 1]
            i = j + 1
            continue

        # $n positional parameter -> pass through
        if ch == '$' and i + 1 < sql_len and sql[i + 1].isdigit():
            j = i + 1
            while j < sql_len and sql[j].isdigit():
                j += 1
            corrected += sql[i:j]
            i = j
            continue

        # Word token -> potential identifier
        if ch.isalpha() or ch == '_':
            j = i
            while j < sql_len and (sql[j].isalnum() or sql[j] == '_'):
                j += 1
            token = sql[i:j]
            lower = token.lower()

            if lower not in SQL_KEYWORDS:
                exact_table = table_map.get(lower)
                exact_column = column_map.get(lower)
                exact_name = exact_table if exact_table is not None else exact_column

                if exact_name is not None and exact_name != token:
                    # Casing mismatch — auto-correct
                    quoted = quote_pg_identifier(exact_name) if is_pg else exact_name
                    corrections.append(f'"{token}" → {quoted}')
                    corrected += quoted
                    i = j
                    continue

                if exact_name is not None and is_pg and exact_name == token:
                    # Correct casing but not yet quoted for PG — wrap it
                    corrected += quote_pg_identifier(exact_name)
                    i = j
                    continue

                # Token not in schema — track as unmatched (but don't fail)
                if exact_name is None and len(token) > 1:
                    unmatched_set.add(token)

            corrected += token
            i = j
            continue

        # Everything else -> pass through
        corrected += ch
        i += 1

    return {
        "correctedSql": corrected,
        "corrections": corrections,
        "unmatchedIdentifiers": list(unmatched_set)
    }
