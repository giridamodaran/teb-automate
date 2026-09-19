import { NextRequest, NextResponse } from "next/server";
import { executeLeadWebhookAutomation } from "@/lib/automation/teb-lead-service";

export const dynamic = "force-dynamic";

function verifyWebhookSecret(request: NextRequest, bodyPayload?: any): boolean {
  const secret = process.env.WEBHOOK_SECRET_KEY;
  if (!secret) return true; // If secret key is not set, allow requests

  const headerSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  const bodySecret = bodyPayload?.secretKey || bodyPayload?.secret_key || bodyPayload?.secret;

  return headerSecret === secret || bodySecret === secret;
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => null);

    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid request payload" },
        { status: 400 }
      );
    }

    if (!verifyWebhookSecret(request, payload)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const automationResult = await executeLeadWebhookAutomation(payload);

    return NextResponse.json(automationResult, { status: automationResult.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Automation engine error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
