import { NextRequest, NextResponse } from 'next/server';
import { getAiApiKey, getConnection } from '@/lib/session';
import Anthropic from '@anthropic-ai/sdk';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

async function generateJSON(prompt: string, apiKey: string, provider: 'groq' | 'anthropic') {
  if (provider === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 1024,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a database performance expert. Respond only in raw JSON matching the requested schema.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Groq AI call failed');
    }
    const text = data.choices?.[0]?.message?.content;
    return JSON.parse(text);
  } else {
    // Anthropic API calls
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: 'You are a database performance expert. Respond only in raw JSON matching the requested schema.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    // Extract JSON block if Anthropic wraps it in conversational text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse JSON from Claude response');
    }
    return JSON.parse(jsonMatch[0]);
  }
}

export async function POST(request: NextRequest) {
  try {
    const aiConfig = await getAiApiKey();
    if (!aiConfig?.key?.trim()) {
      return NextResponse.json(
        { error: 'AI API key not configured. Add a Groq or Anthropic key in Settings.' },
        { status: 400 }
      );
    }

    const connection = await getConnection();
    if (!connection) {
      return NextResponse.json({ error: 'No database connection' }, { status: 400 });
    }

    const body = await request.json();
    const { action, sql, history } = body;

    if (action === 'query') {
      if (!sql) return NextResponse.json({ error: 'SQL query required' }, { status: 400 });

      const prompt = `You are a database performance analysis system. Analyze this SQL query:
Query: ${sql}
Dialect: ${connection.type}

Analyze potential bottlenecks (such as missing indexes, full table scans, SELECT *, partition limits, bad joins, etc.) and propose optimizations.

Return EXACTLY this JSON structure:
{
  "rootCause": "Short diagnosis of bottleneck...",
  "impact": "High" | "Medium" | "Low",
  "optimizedQuery": "Fully formed SQL query or DDL statement (e.g. CREATE INDEX ...) to resolve this...",
  "isDdl": true, (true if optimizedQuery is a schema DDL index creation, false if it is a rewritten select/update query)
  "explanation": "Brief explanation of how this optimization works...",
  "estTimeBefore": 250, (estimated time in ms prior to fix)
  "estTimeAfter": 15, (estimated time in ms after fix)
  "estScannedBefore": 10000, (estimated rows scanned before)
  "estScannedAfter": 10 (estimated rows scanned after)
}`;

      const analysis = await generateJSON(prompt, aiConfig.key, aiConfig.provider);
      return NextResponse.json(analysis);
    } else if (action === 'db') {
      const prompt = `You are a database health monitoring system. Analyze this connection type: "${connection.type}" and this query execution history:
History: ${JSON.stringify((history || []).slice(0, 20))}

Provide an overall health audit. Estimate or formulate score metrics between 0 and 100.

Return EXACTLY this JSON structure:
{
  "queryEfficiency": 80, (score 0-100)
  "indexCoverage": 75, (score 0-100)
  "schemaQuality": 85, (score 0-100)
  "overallScore": 80, (score 0-100)
  "recommendations": [
    "Point 1...",
    "Point 2...",
    "Point 3..."
  ]
}`;

      const dbReport = await generateJSON(prompt, aiConfig.key, aiConfig.provider);
      return NextResponse.json(dbReport);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('AI analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
