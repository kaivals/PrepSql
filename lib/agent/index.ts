import { Command } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { graph } from './graph';
import { getConnection } from '../app-state';

export interface RunAgentInput {
  prompt: string;
  threadId: string;
  action?: 'approve' | 'reject';
}

export async function runAgent(input: RunAgentInput) {
  const { prompt, threadId, action } = input;

  const config = {
    configurable: {
      thread_id: threadId,
    },
  };

  // If we are resuming from an interrupt (user decision)
  if (action) {
    const finalState = (await graph.invoke(
      new Command({ resume: action }),
      config
    )) as any;

    if (finalState?.__interrupt__ && finalState.__interrupt__.length > 0) {
      return {
        type: 'pending_approval',
        pendingApproval: true,
        sql: finalState.generatedSQL,
        explanation: finalState.explanation,
        isMutation: true,
        mutationType: finalState.mutationType,
        identifierCorrections: finalState.identifierCorrections,
        unmatchedIdentifiers: finalState.unmatchedIdentifiers,
      };
    }

    return {
      ...finalState.finalResponse,
      pendingApproval: false,
    };
  }

  // Otherwise, start a new execution
  const connection = await getConnection();
  if (!connection) {
    throw new Error('No active database connection. Please connect to a database first.');
  }

  const initialState = {
    messages: [new HumanMessage(prompt)],
    userPrompt: prompt,
    threadId: threadId,
    dbDialect: connection.type,
    connectionId: connection.id,
    retryCount: 0,
  };

  const finalState = (await graph.invoke(initialState, config)) as any;

  if (finalState?.__interrupt__ && finalState.__interrupt__.length > 0) {
    return {
      type: 'pending_approval',
      pendingApproval: true,
      sql: finalState.generatedSQL,
      explanation: finalState.explanation,
      isMutation: true,
      mutationType: finalState.mutationType,
      identifierCorrections: finalState.identifierCorrections,
      unmatchedIdentifiers: finalState.unmatchedIdentifiers,
    };
  }

  return {
    ...finalState.finalResponse,
    pendingApproval: false,
  };
}
