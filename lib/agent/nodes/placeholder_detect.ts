// lib/agent/nodes/placeholder_detect.ts
import type { AgentStateType } from "../state";

const PLACEHOLDER_PATTERNS = [
  /'\[.*?\]'/gi, // '[last_name]', '[value]'
  /'<.*?>'/gi, // '<last_name>'
  /'placeholder'/gi, // literal word placeholder
  /'unknown'/gi, // literal word unknown
  /'your_.*?'/gi, // 'your_last_name'
  /= ''/g, // empty string filter
  /'NULL'/gi, // string 'NULL' as value
  /= \$\w+/g, // unreplaced vars like $lastName
  /\[MISSING.*?\]/gi, // [MISSING_VALUE]
  /\[.*?_HERE\]/gi, // [VALUE_HERE]
];

function detectPlaceholders(sql: string): string[] {
  const found: string[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = sql.match(pattern);
    if (matches) found.push(...matches);
  }
  return [...new Set(found)];
}

function extractMissingFieldNames(placeholders: string[]): string[] {
  return placeholders.map((p) => p.replace(/['\[\]<>]/g, "").trim());
}

function buildClarificationQuestion(
  missingFields: string[],
  userPrompt: string,
): string {
  if (missingFields.length === 1) {
    return `To complete this query safely, I need one more detail: what is the ${missingFields[0]}?`;
  }
  const fieldList = missingFields.join(", ");
  return `To complete this query safely, I need a few more details: ${fieldList}. Could you provide these?`;
}

export async function placeholderDetectNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  if (!state.generatedSQL) return {};

  const placeholders = detectPlaceholders(state.generatedSQL);

  if (placeholders.length === 0) return {}; // clean — proceed

  const missingFields = extractMissingFieldNames(placeholders);
  const question = buildClarificationQuestion(missingFields, state.userPrompt);

  return {
    pendingClarification: {
      reason: "placeholder",
      missingFields,
      partialSQL: state.generatedSQL, // save for resume
      question,
    },
    finalResponse: {
      type: "clarification",
      message: question,
    },
  };
}
