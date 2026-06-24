import { connectMongo } from './lib/mongodb';
import { ensureIndexes } from './lib/db';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      await connectMongo();
      await ensureIndexes();
    } catch (error) {
      console.error('[instrumentation] Failed to connect to MongoDB:', error);
    }
  }
}
