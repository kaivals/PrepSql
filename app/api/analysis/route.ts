import { NextRequest, NextResponse } from 'next/server';
import { getClientId } from '@/lib/app-state';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, targetSql, result } = body;

    if (!action || !result) {
      return NextResponse.json(
        { error: 'action and result are required' },
        { status: 400 }
      );
    }

    const clientId = await getClientId();

    const { error } = await supabase.from('analysis_results').insert({
      session_id: clientId,
      action,
      target_sql: targetSql || null,
      result,
    });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save analysis' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const clientId = await getClientId();

    const { data, error } = await supabase
      .from('analysis_results')
      .select('*')
      .eq('session_id', clientId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ analyses: data || [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load analyses' },
      { status: 500 }
    );
  }
}
