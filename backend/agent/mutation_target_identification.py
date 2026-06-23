import re
from typing import Dict, List, Any, Optional, Tuple
from schema import quote_pg_identifier
from database import execute_query

def quote_table(table: str, dialect: str) -> str:
    return quote_pg_identifier(table) if dialect == 'postgresql' else table

def quote_column(column: str, dialect: str) -> str:
    return quote_pg_identifier(column) if dialect == 'postgresql' else column

def escape_sql_string(value: str) -> str:
    return value.replace("'", "''")

def format_sql_value(value: Any) -> str:
    if isinstance(value, (int, float)):
        return str(value)
    return f"'{escape_sql_string(str(value))}'"

def get_message_content(msg: Any) -> str:
    content = msg.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and 'text' in part:
                parts.append(str(part['text']))
        return "\n".join(parts)
    return str(content)

def build_conversation_context(
    user_prompt: str,
    messages: List[Any],
    max_messages: int = 12
) -> str:
    history_msgs = messages[-max_messages:]
    history_lines = []
    for msg in history_msgs:
        role = "user" if msg.type == "human" else "assistant"
        history_lines.append(f"{role}: {get_message_content(msg)}")
    
    history_str = "\n".join(history_lines)
    return f"{history_str}\nuser: {user_prompt}".strip()

def infer_target_table(context: str, schema_info: Optional[List[Dict[str, Any]]]) -> Optional[str]:
    if not schema_info:
        return None

    lower_context = context.lower()
    mentioned = [table for table in schema_info if table.get("name", "").lower() in lower_context]
    
    if len(mentioned) >= 1:
        return mentioned[0].get("name")

    if re.search(r'\bemployee(s)?\b', lower_context):
        for table in schema_info:
            if table.get("name", "").lower() == 'employees':
                return table.get("name")

    # Fallback to tables containing first_name and last_name
    name_tables = []
    for table in schema_info:
        column_names = [col.get("name", "").lower() for col in table.get("columns", [])]
        if 'first_name' in column_names and 'last_name' in column_names:
            name_tables.append(table)
            
    if len(name_tables) == 1:
        return name_tables[0].get("name")

    return None

def extract_email(context: str) -> Optional[str]:
    match = re.search(r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', context, re.IGNORECASE)
    return match.group(0) if match else None

def extract_id(context: str) -> Optional[int]:
    patterns = [
        r'\bid\s*(?:is|=|:)?\s*(\d+)\b',
        r'\bemployee\s+id\s*(\d+)\b',
        r'\brow\s+(\d+)\b'
    ]
    for pattern in patterns:
        match = re.search(pattern, context, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None

def is_likely_person_name(value: str) -> bool:
    stop_words = {
        'all', 'any', 'each', 'every', 'name', 'names', 'employee', 'employees',
        'user', 'users', 'row', 'rows', 'record', 'records', 'this', 'that', 'the',
        'with', 'without', 'from', 'into', 'to', 'for', 'and', 'or', 'now', 'do',
    }
    return bool(re.match(r'^[A-Z][a-z]+$', value)) and value.lower() not in stop_words

def extract_first_and_last_name(context: str) -> Optional[Dict[str, str]]:
    collected_first = None
    collected_last = None

    first_mentions = [
        m.group(1) for m in re.finditer(r'first[_\s-]*name\s*(?:is|=|:)?\s*[\'"]?([A-Za-z]+)[\'"]?', context, re.IGNORECASE)
    ] + [
        m.group(1) for m in re.finditer(r'\bfirst\s+name\s+is\s+[\'"]?([A-Za-z]+)[\'"]?', context, re.IGNORECASE)
    ]
    
    last_mentions = [
        m.group(1) for m in re.finditer(r'last[_\s-]*name\s*(?:is|=|:)?\s*[\'"]?([A-Za-z]+)[\'"]?', context, re.IGNORECASE)
    ] + [
        m.group(1) for m in re.finditer(r'\blast\s+name\s+is\s+[\'"]?([A-Za-z]+)[\'"]?', context, re.IGNORECASE)
    ]

    for first in first_mentions:
        if len(first) > 1:
            collected_first = first.capitalize()
    for last in last_mentions:
        if len(last) > 1:
            collected_last = last.capitalize()

    if collected_first and collected_last:
        return {"firstName": collected_first, "lastName": collected_last}

    explicit_patterns = [
        r'first[_\s-]*name\s*(?:is|=|:)?\s*[\'"]?([A-Za-z]+)[\'"]?[\s,]+(?:and\s+)?last[_\s-]*name\s*(?:is|=|:)?\s*[\'"]?([A-Za-z]+)[\'"]?',
        r'last[_\s-]*name\s*(?:is|=|:)?\s*[\'"]?([A-Za-z]+)[\'"]?[\s,]+(?:and\s+)?first[_\s-]*name\s*(?:is|=|:)?\s*[\'"]?([A-Za-z]+)[\'"]?',
        r'first[_\s-]*name\s+[\'"]?([A-Za-z]+)[\'"]?\s+and\s+last[_\s-]*name\s+[\'"]?([A-Za-z]+)[\'"]?'
    ]

    for pattern in explicit_patterns:
        match = re.search(pattern, context, re.IGNORECASE)
        if not match:
            continue
        is_last_first = pattern.startswith('last')
        firstName = match.group(2) if is_last_first else match.group(1)
        lastName = match.group(1) if is_last_first else match.group(2)
        if len(firstName) > 1 and len(lastName) > 1:
            return {"firstName": firstName.capitalize(), "lastName": lastName.capitalize()}

    full_name_patterns = [
        r'\b(?:update|change|modify|rename|delete|remove)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b',
        r'\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+with\s+(?:name|to)\b',
        r'\bemployee\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b',
        r'\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+to\s+[A-Z][a-z]+\b'
    ]

    for pattern in full_name_patterns:
        match = re.search(pattern, context)
        if match and is_likely_person_name(match.group(1)) and is_likely_person_name(match.group(2)):
            return {"firstName": match.group(1), "lastName": match.group(2)}

    # Tab-separated rows or field patterns
    row_match = re.search(
        r'\b([A-Z][a-z]+)\t([A-Z][a-z]+)\b.*@|\bfirst_name\b[^\n]*\b([A-Za-z]+)\b[^\n]*\b\last_name\b[^\n]*\b([A-Za-z]+)\b',
        context, re.IGNORECASE
    )
    if row_match:
        if row_match.group(3) and row_match.group(4) and is_likely_person_name(row_match.group(3)) and is_likely_person_name(row_match.group(4)):
            return {"firstName": row_match.group(3), "lastName": row_match.group(4)}
        if row_match.group(1) and row_match.group(2) and is_likely_person_name(row_match.group(1)) and is_likely_person_name(row_match.group(2)):
            return {"firstName": row_match.group(1), "lastName": row_match.group(2)}

    # result row
    result_row_match = re.search(r'\b\d+\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b', context)
    if result_row_match and is_likely_person_name(result_row_match.group(1)) and is_likely_person_name(result_row_match.group(2)):
        return {"firstName": result_row_match.group(1), "lastName": result_row_match.group(2)}

    return None

def extract_target_identifiers(
    context: str,
    schema_info: Optional[List[Dict[str, Any]]]
) -> Optional[Dict[str, Any]]:
    table = infer_target_table(context, schema_info)
    if not table:
        return None

    table_schema = None
    for entry in schema_info or []:
        if entry.get("name") == table:
            table_schema = entry
            break
            
    if not table_schema:
        return None

    column_names = {col.get("name", "").lower() for col in table_schema.get("columns", [])}
    conditions = {}

    id_val = extract_id(context)
    if id_val is not None and 'id' in column_names:
        conditions['id'] = id_val
        return {"table": table, "conditions": conditions}

    email_val = extract_email(context)
    if email_val and 'email' in column_names:
        conditions['email'] = email_val
        return {"table": table, "conditions": conditions}

    names = extract_first_and_last_name(context)
    if names and 'first_name' in column_names and 'last_name' in column_names:
        conditions['first_name'] = names['firstName']
        conditions['last_name'] = names['lastName']
        return {"table": table, "conditions": conditions}

    return {"table": table, "conditions": conditions} if conditions else None

def build_count_sql(target: Dict[str, Any], dialect: str) -> str:
    table_ref = quote_table(target["table"], dialect)
    where_conds = []
    for column, value in target["conditions"].items():
        column_ref = quote_column(column, dialect)
        where_conds.append(f"{column_ref} = {format_sql_value(value)}")
    where_clause = " AND ".join(where_conds)
    return f"SELECT COUNT(*) AS count FROM {table_ref} WHERE {where_clause}"

def verify_unique_target(
    target: Dict[str, Any],
    dialect: str,
    connection: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    try:
        sql = build_count_sql(target, dialect)
        result = execute_query(connection, sql)
        
        count_val = -1
        if result.get("rows"):
            first_row = result["rows"][0]
            # Handle potential lowercase/uppercase count keys
            for k in ("count", "COUNT"):
                if k in first_row:
                    count_val = int(first_row[k])
                    break
                    
        if count_val < 0:
            return None
        return {"unique": count_val == 1, "count": count_val}
    except Exception as e:
        print(f"[Mutation Target Identification] Count query failed: {e}")
        return None

def identifiers_from_execution_result(
    execution_result: Optional[Dict[str, Any]],
    schema_info: Optional[List[Dict[str, Any]]],
    table_hint: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    if not execution_result or execution_result.get("rowCount") != 1 or not execution_result.get("rows"):
        return None

    row = execution_result["rows"][0]
    table = table_hint
    
    if not table and schema_info:
        for entry in schema_info:
            col_names = {col.get("name", "").lower() for col in entry.get("columns", [])}
            # Check if all row keys exist in this table schema
            if all(k.lower() in col_names for k in row.keys()):
                table = entry.get("name")
                break

    if not table:
        return None

    table_schema = None
    for entry in schema_info or []:
        if entry.get("name") == table:
            table_schema = entry
            break
    if not table_schema:
        return None
        
    column_names = {col.get("name", "").lower() for col in table_schema.get("columns", [])}
    conditions = {}

    if 'id' in row and row['id'] is not None and 'id' in column_names:
        conditions['id'] = int(row['id'])
        return {"table": table, "conditions": conditions}
    if isinstance(row.get('email'), str) and 'email' in column_names:
        conditions['email'] = row['email']
        return {"table": table, "conditions": conditions}
    if isinstance(row.get('first_name'), str) and isinstance(row.get('last_name'), str) and 'first_name' in column_names and 'last_name' in column_names:
        conditions['first_name'] = row['first_name']
        conditions['last_name'] = row['last_name']
        return {"table": table, "conditions": conditions}

    return None
