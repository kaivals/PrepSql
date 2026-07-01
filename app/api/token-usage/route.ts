import { NextRequest, NextResponse } from "next/server";
import { getClientId } from "@/lib/app-state";
import { getTokenUsage, trackTokenUsage } from "@/lib/token-tracker";

export async function GET() {
  try {
    const clientId = await getClientId();
    const usage = await getTokenUsage(clientId);
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch token usage" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { promptTokens = 0, completionTokens = 0 } = body as {
      promptTokens: number;
      completionTokens: number;
    };

    // Validate that promptTokens and completionTokens are finite non-negative integers
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(completionTokens) ||
      promptTokens < 0 ||
      completionTokens < 0 ||
      !Number.isInteger(promptTokens) ||
      !Number.isInteger(completionTokens)
    ) {
      return NextResponse.json(
        {
          error:
            "promptTokens and completionTokens must be non-negative integers",
        },
        { status: 400 },
      );
    }

    const clientId = await getClientId();
    await trackTokenUsage(clientId, promptTokens, completionTokens);

    const usage = await getTokenUsage(clientId);
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update token usage" },
      { status: 500 },
    );
  }
}
