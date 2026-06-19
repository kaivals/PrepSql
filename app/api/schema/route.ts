import { NextResponse } from 'next/server';
import { getConnection } from '@/lib/app-state';
import { introspectSchema } from '@/lib/schema';

export async function GET() {
  try {
    const connection = await getConnection();
    if (!connection) {
      return NextResponse.json({ error: 'No database connection' }, { status: 400 });
    }

    const tables = await introspectSchema(connection);
    return NextResponse.json({ tables });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load schema' },
      { status: 500 }
    );
  }
}
