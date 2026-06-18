import { AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../state';

export function responderNode(
  state: AgentStateType
): Partial<AgentStateType> {
  // If there's an error and no finalResponse already set, surface it
  if (state.error && !state.finalResponse) {
    const errMsg = state.error;
    const aiMessage = new AIMessage(`Error: ${errMsg}`);
    return {
      messages: [aiMessage],
      finalResponse: {
        type: 'error',
        message: errMsg,
      },
    };
  }

  if (state.intent === 'greeting') {
    const msg = "Hi! I'm your SQL assistant. Ask me to query your database, explore your tables, or modify data.";
    const aiMessage = new AIMessage(msg);
    return {
      messages: [aiMessage],
      finalResponse: {
        type: 'greeting',
        message: msg,
      },
    };
  }

  if (state.intent === 'out_of_scope') {
    const msg = "I'm focused on database queries. I can help you fetch, analyze, or modify data in your connected database.";
    const aiMessage = new AIMessage(msg);
    return {
      messages: [aiMessage],
      finalResponse: {
        type: 'answer',
        message: msg,
      },
    };
  }

  if (state.intent === 'table_structure') {
    const msg = state.schemaFormatted || 'No schema information available.';
    const aiMessage = new AIMessage(`Table Structure:\n${msg}`);
    return {
      messages: [aiMessage],
      finalResponse: {
        type: 'schema_info',
        message: msg,
      },
    };
  }

  // Fallback — if finalResponse was already set by an earlier node, pass through
  if (state.finalResponse) {
    const msgText = state.finalResponse.message || state.finalResponse.explanation || '';
    const aiMessage = new AIMessage(msgText);
    return {
      messages: [aiMessage],
    };
  }

  const defaultMsg = 'Something unexpected happened. Please try again.';
  return {
    messages: [new AIMessage(defaultMsg)],
    finalResponse: {
      type: 'error',
      message: defaultMsg,
    },
  };
}
