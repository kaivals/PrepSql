import re
from typing import Dict, Any, List

PLACEHOLDER_PATTERNS = [
    r'\'\[.*?\]\'',         # '[last_name]', '[value]'
    r'\'<.*?>\'',           # '<last_name>'
    r'\'placeholder\'',     # literal word placeholder
    r'\'unknown\'',         # literal word unknown
    r'\'your_.*?\'',        # 'your_last_name'
    r'= \'\'',               # empty string filter
    r'\'NULL\'',            # string 'NULL' as value
    r'= \$\w+',            # unreplaced vars like $lastName
    r'\[MISSING.*?\]',    # [MISSING_VALUE]
    r'\[.*?_HERE\]',      # [VALUE_HERE]
]

def detect_placeholders(sql: str) -> List[str]:
    found = []
    for pattern in PLACEHOLDER_PATTERNS:
        matches = re.findall(pattern, sql, re.IGNORECASE)
        if matches:
            found.extend(matches)
    # Remove duplicates preserving order
    seen = set()
    return [x for x in found if not (x in seen or seen.add(x))]

def extract_missing_field_names(placeholders: List[str]) -> List[str]:
    cleaned = []
    for p in placeholders:
        # Strip quote/brackets characters
        f = re.sub(r'[\'\[\]<>]', '', p).strip()
        cleaned.append(f)
    return cleaned

def build_clarification_question(missing_fields: List[str]) -> str:
    if len(missing_fields) == 1:
        return f"To complete this query safely, I need one more detail: what is the {missing_fields[0]}?"
    field_list = ", ".join(missing_fields)
    return f"To complete this query safely, I need a few more details: {field_list}. Could you provide these?"

def placeholder_detect_node(state: Dict[str, Any]) -> Dict[str, Any]:
    generated_sql = state.get("generated_sql")
    if not generated_sql:
        return {}

    placeholders = detect_placeholders(generated_sql)
    if not placeholders:
        return {}  # clean — proceed

    missing_fields = extract_missing_field_names(placeholders)
    question = build_clarification_question(missing_fields)

    return {
        "pending_clarification": {
            "reason": "placeholder",
            "missingFields": missing_fields,
            "partialSQL": generated_sql,  # save for resume
            "question": question
        },
        "final_response": {
            "type": "clarification",
            "message": question
        }
    }
