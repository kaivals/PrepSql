import { NextRequest, NextResponse } from 'next/server';
import { getSessionId } from './session';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export async function proxyToBackend(request: NextRequest, endpoint: string) {
  try {
    const sessionId = await getSessionId();
    const { searchParams } = new URL(request.url);
    const queryStr = searchParams.toString();
    const url = `${BACKEND_URL}${endpoint}${queryStr ? `?${queryStr}` : ''}`;

    const headers: Record<string, string> = {
      'x-prepsql-session-id': sessionId,
    };

    const options: RequestInit = {
      method: request.method,
      headers,
    };

    // Forward body for non-GET/HEAD methods
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        const bodyText = await request.text();
        if (bodyText) {
          options.body = bodyText;
          headers['Content-Type'] = 'application/json';
        }
      } catch (e) {
        // Request has no body
      }
    }

    const response = await fetch(url, options);
    
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } else {
      const text = await response.text();
      return new NextResponse(text, { 
        status: response.status,
        headers: { 'content-type': contentType }
      });
    }
  } catch (error: any) {
    console.error(`[Proxy Error] Failed to proxy to ${endpoint}:`, error);
    return NextResponse.json(
      { error: `Backend service is unreachable. Is FastAPI running on port 8000? Details: ${error.message}` },
      { status: 502 }
    );
  }
}
