import { NextRequest, NextResponse } from "next/server";
import { clearAiApiKey, getAiKeyInfo, setAiApiKey } from "@/lib/app-state";

export async function GET() {
  const info = await getAiKeyInfo();
  return NextResponse.json({
    configured: info.configured,
    provider: info.provider,
    source: info.source,
    maskedKey: info.maskedKey,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 },
      );
    }

    const trimmed = apiKey.trim();
    if (!trimmed.startsWith("gsk_") && !trimmed.startsWith("sk-ant-")) {
      return NextResponse.json(
        {
          error:
            "Invalid API key format. Use a Groq key (gsk_...) or Anthropic key (sk-ant-...).",
        },
        { status: 400 },
      );
    }

    await setAiApiKey(trimmed);
    const info = await getAiKeyInfo();

    return NextResponse.json({
      success: true,
      configured: true,
      provider: info.provider,
      source: info.source,
      maskedKey: info.maskedKey,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save API key",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    await clearAiApiKey();
    const info = await getAiKeyInfo();
    return NextResponse.json({
      success: true,
      configured: info.configured,
      source: info.source,
      provider: info.provider,
      maskedKey: info.maskedKey,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to remove API key",
      },
      { status: 500 },
    );
  }
}
