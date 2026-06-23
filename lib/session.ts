import { cookies, headers } from 'next/headers';
import { randomBytes } from 'crypto';

export async function getSessionId(): Promise<string> {
  const headerStore = await headers();
  const headerSessionId = headerStore.get('x-prepsql-session-id');
  if (headerSessionId) {
    return headerSessionId;
  }

  const cookieStore = await cookies();
  let sessionId = cookieStore.get('prepsql-session')?.value;

  if (!sessionId) {
    sessionId = randomBytes(16).toString('hex');
    cookieStore.set('prepsql-session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return sessionId;
}
