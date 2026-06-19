import { ChatGroq } from '@langchain/groq';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getGroqApiKey } from '../../app-state';
import type { AgentStateType } from '../state';
import {
  buildConversationContext,
  extractTargetIdentifiers,
  identifiersFromExecutionResult,
  inferTargetTable,
  verifyUniqueTarget,
} from '../mutation-target-identification';

function isMutationIntent(intent: string): boolean {
  return intent === 'sql_modification' || intent === 'sql_schema';
}

function isIntentionalBulkMutation(context: string): boolean {
  return /\b(all|every)\s+(employees?|users?|rows?|records?|entries)\b/i.test(context)
    || /\bupdate\s+all\b/i.test(context)
    || /\bdelete\s+all\b/i.test(context);
}

async function hasSufficientTargetIdentification(
  state: AgentStateType,
): Promise<boolean> {
  const context = buildConversationContext(state.userPrompt, state.messages);
  const tableHint = inferTargetTable(context, state.schemaInfo);

  if (isIntentionalBulkMutation(context)) {
    return true;
  }

  const fromResult = identifiersFromExecutionResult(
    state.executionResult,
    state.schemaInfo,
    tableHint,
  );
  if (fromResult) {
    const verification = await verifyUniqueTarget(fromResult, state.dbDialect);
    if (verification?.unique) return true;
  }

  const extracted = extractTargetIdentifiers(context, state.schemaInfo);
  if (!extracted) return false;

  const verification = await verifyUniqueTarget(extracted, state.dbDialect);
  return verification?.unique === true;
}

export async function mutationAmbiguityCheckNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  if (!isMutationIntent(state.intent)) return {};

  if (state.skipMutationAmbiguityCheck) {
    return { skipMutationAmbiguityCheck: false };
  }

  if (await hasSufficientTargetIdentification(state)) {
    return {};
  }

  const apiKey = await getGroqApiKey();
  const llm = new ChatGroq({
    apiKey,
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    maxTokens: 200,
    maxRetries: 0,
  });

  const conversationContext = buildConversationContext(state.userPrompt, state.messages);

  const systemPrompt = `
You are checking if a database mutation request has enough 
information to write a safe, unambiguous WHERE clause.

Respond ONLY in JSON. Two possible responses:

If sufficient:
{ "sufficient": true }

If not sufficient:
{
  "sufficient": false,
  "question": "exact question to ask the user",
  "missing": ["field1", "field2"]
}

Rules:
- Consider the FULL conversation history, not just the latest message.
- If the user already identified a row earlier in the conversation, that counts.
- first_name AND last_name together ARE sufficient to identify a row when both are provided.
- id, email, or a full name (first + last) are sufficient unique identifiers.
- Only first_name alone (without last_name) is NOT sufficient when both columns exist.
- If a primary key is mentioned anywhere in the conversation, it IS sufficient.
- If updating/deleting ALL rows intentionally, it IS sufficient.
- Do NOT ask for id or email if first_name and last_name are already known.
- Ask at most one focused question for the smallest missing detail.
`.trim();

  const userMessage = `
Database schema summary:
${state.schemaFormatted || 'No schema available.'}

Full conversation:
${conversationContext}

Latest user request: "${state.userPrompt}"

Is there enough information to safely identify the target row(s)?
`.trim();

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ], {
      response_format: { type: 'json_object' },
    });

    const raw = typeof response.content === 'string' ? response.content.trim() : '';
    const result = JSON.parse(raw || '{}');

    if (result.sufficient === false) {
      const question = result.question || 'Could you provide more specific criteria to target the rows for mutation?';
      return {
        generatedSQL: '',
        pendingClarification: {
          reason: 'mutation_ambiguity',
          missingFields: result.missing ?? [],
          partialSQL: '',
          question: question,
        },
        finalResponse: {
          type: 'clarification',
          message: question,
        },
      };
    }
  } catch (error) {
    console.error('[Mutation Ambiguity Check] Error:', error);
  }

  return {};
}
