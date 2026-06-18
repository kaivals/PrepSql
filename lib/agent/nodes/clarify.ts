import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../state';

function isFollowUpAnswer(state: AgentStateType): boolean {
  if (!state.pendingClarification) return false;
  const messages = state.messages;

  const getType = (msg: any) => {
    if (typeof msg._getType === 'function') return msg._getType();
    return msg.type || '';
  };

  const latestIsHuman = messages.length > 0 && getType(messages[messages.length - 1]) === 'human';
  if (!latestIsHuman) return false;

  const question = state.pendingClarification.question;
  const hasQuestionInHistory = messages.some(
    (msg) => getType(msg) === 'ai' && String(msg.content).includes(question.slice(0, 40)),
  );

  // Accept the user's reply once we've asked, or after any prior assistant turn.
  return hasQuestionInHistory || messages.some((msg) => getType(msg) === 'ai');
}

export function clarifyNode(
  state: AgentStateType
): Partial<AgentStateType> {

  // Case 1: standard clarify_needed intent
  if (state.intent === 'clarify_needed' && !state.pendingClarification) {
    const question = 'I need a bit more context to generate the right query. Could you clarify which table(s) you are interested in, and what result you are looking for?';
    const aiMessage = new AIMessage(question);
    return {
      messages: [aiMessage],
      finalResponse: {
        type: 'clarification',
        message: question,
        question,
      },
    };
  }

  // Case 2: pending clarification from placeholder or mutation check
  if (state.pendingClarification) {
    const { question, partialSQL, missingFields } = state.pendingClarification;

    // On next user turn, the answer comes in as userPrompt
    // Check if this is the follow-up answer turn
    if (isFollowUpAnswer(state)) {

      // Inject the answer into messages and resume sql_generate
      const resumeContext = new HumanMessage(
        `Previous partial query had placeholders for: ${missingFields.join(', ')}.
         
User provided: "${state.userPrompt}"

${partialSQL
  ? `Resume from this partial SQL, replace placeholders with the user-provided values:\n\`\`\`sql\n${partialSQL}\n\`\`\``
  : 'Now generate the complete SQL with the provided values.'
}`
      );

      const resumedFromMutationAmbiguity =
        state.pendingClarification.reason === 'mutation_ambiguity';

      return {
        messages: [resumeContext],
        pendingClarification: null,
        generatedSQL: '',
        finalResponse: null,
        skipMutationAmbiguityCheck: resumedFromMutationAmbiguity,
      };
    }

    // Still waiting for answer — output the question
    const aiMessage = new AIMessage(question);
    return {
      messages: [aiMessage],
      finalResponse: {
        type: 'clarification',
        message: question,
        question,
      },
    };
  }

  return {};
}
