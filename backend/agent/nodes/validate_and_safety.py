import re
from typing import Dict, Any, List, Tuple
from sql_validator import validate_and_correct_sql

MUTATION_PATTERNS = re.compile(r'\b(DELETE|UPDATE|DROP|ALTER|INSERT)\b', re.IGNORECASE)

def validate_tables_exist_in_schema(sql: str, schema_info: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    if not schema_info:
        return True, []

    known_tables = {t.get("name", "").lower() for t in schema_info}

    # Extract tables from FROM, JOIN, INTO, UPDATE
    table_pattern = re.compile(r'(?:FROM|JOIN|INTO|UPDATE)\s+[`"\']?(\w+)[`"\']?', re.IGNORECASE)
    used_tables = [m.group(1).lower() for m in table_pattern.finditer(sql)]

    # CTE names
    cte_pattern = re.compile(r'WITH\s+[`"\']?(\w+)[`"\']?\s+AS', re.IGNORECASE)
    cte_names = {m.group(1).lower() for m in cte_pattern.finditer(sql)}

    unknown_tables = [
        t for t in used_tables
        if t not in known_tables and t not in cte_names and t != 'dual'
    ]

    # Deduplicate unknown tables
    unknown_tables = list(set(unknown_tables))

    return len(unknown_tables) == 0, unknown_tables

def validate_and_safety_node(state: Dict[str, Any]) -> Dict[str, Any]:
    sql = state.get("generated_sql")
    if not sql:
        return {}

    schema_info = state.get("schema_info") or []

    # 1. Table Existence Check
    valid, unknown_tables = validate_tables_exist_in_schema(sql, schema_info)
    if not valid:
        available = []
        for t in schema_info:
            cols = ", ".join([col.get("name") for col in t.get("columns", [])])
            available.append(f"- {t.get('name')} ({cols})")
        available_str = "\n".join(available)

        return {
            "generated_sql": "",
            "error": f"Unknown tables: {', '.join(unknown_tables)}",
            "final_response": {
                "type": "error",
                "message": f"The query references tables that don't exist in your database: {', '.join(unknown_tables)}.\n\nAvailable tables:\n{available_str}"
            }
        }

    # 2. Identifier Standardization
    db_dialect = state.get("db_dialect", "sqlite")
    result = validate_and_correct_sql(sql, schema_info, db_dialect)
    standardized_sql = result.get("correctedSql", sql)

    # 3. Safety Check
    is_mutation = bool(MUTATION_PATTERNS.search(standardized_sql))
    mutation_match = MUTATION_PATTERNS.search(standardized_sql)
    mutation_type = mutation_match.group(1).upper() if mutation_match else ""

    update = {
        "generated_sql": standardized_sql,
        "is_mutation": is_mutation,
        "mutation_type": mutation_type,
        "identifier_corrections": result.get("corrections", []),
        "unmatched_identifiers": result.get("unmatchedIdentifiers", [])
    }

    final_resp = state.get("final_response")
    if final_resp:
        # copy dict to avoid changing original state dict by reference
        updated_final = dict(final_resp)
        updated_final.update({
            "sql": standardized_sql,
            "identifierCorrections": result.get("corrections", []),
            "unmatchedIdentifiers": result.get("unmatchedIdentifiers", []),
            "isMutation": is_mutation,
            "mutationType": mutation_type
        })
        if is_mutation:
            updated_final["pendingApproval"] = True
        update["final_response"] = updated_final

    return update
