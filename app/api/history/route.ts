import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend-proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/api/history');
}

export async function DELETE(request: NextRequest) {
  return proxyToBackend(request, '/api/history');
}
