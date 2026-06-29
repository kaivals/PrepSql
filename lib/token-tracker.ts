import { getDb } from './mongodb';

const COLLECTION = 'token_usage';

/** Daily token budget for Groq free tier (llama-3.3-70b-versatile): ~30,000 tokens/day */
export const TOKEN_DAILY_BUDGET = 30_000;

function getTodayKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Increment the cumulative token usage for a given session on the current UTC day.
 * Returns the updateOne promise so callers can await the write if needed.
 */
export function trackTokenUsage(
  sessionId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  if (!sessionId || (!promptTokens && !completionTokens)) {
    return Promise.resolve();
  }

  const todayKey = getTodayKey();

  return getDb()
    .collection(COLLECTION)
    .updateOne(
      { sessionId, dateKey: todayKey },
      {
        $inc: {
          totalTokens: promptTokens + completionTokens,
          promptTokens,
          completionTokens,
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true },
    )
    .then(() => undefined);
}

/**
 * Read the cumulative token usage for a session on the current UTC day.
 */
export async function getTokenUsage(sessionId: string): Promise<{
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  budget: number;
  percentage: number;
}> {
  const todayKey = getTodayKey();

  try {
    const db = getDb();
    const doc = await db.collection(COLLECTION).findOne({ sessionId, dateKey: todayKey });

    const totalTokens: number = (doc as any)?.totalTokens ?? 0;
    const promptTokens: number = (doc as any)?.promptTokens ?? 0;
    const completionTokens: number = (doc as any)?.completionTokens ?? 0;

    return {
      totalTokens,
      promptTokens,
      completionTokens,
      budget: TOKEN_DAILY_BUDGET,
      percentage: Math.min(100, Math.round((totalTokens / TOKEN_DAILY_BUDGET) * 100)),
    };
  } catch {
    return {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      budget: TOKEN_DAILY_BUDGET,
      percentage: 0,
    };
  }
}
