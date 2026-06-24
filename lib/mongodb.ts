import { MongoClient, type Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/prepsql';

let client: MongoClient | null = null;
let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;

  if (!client) {
    client = new MongoClient(MONGODB_URI);
  }

  db = client.db();
  return db;
}

/**
 * Connect to MongoDB. Safe to call multiple times (idempotent).
 * Call once at server startup; the connection is reused across all requests.
 */
export async function connectMongo(): Promise<void> {
  if (client) return; // already connected

  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();
  console.log('[mongodb] Connected to', MONGODB_URI);
}

export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[mongodb] Disconnected');
  }
}
