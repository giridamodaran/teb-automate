import { NextRequest, NextResponse } from "next/server";
import { executeLeadWebhookAutomation } from "@/lib/automation/teb-lead-service";

export const dynamic = "force-dynamic";

function verifyWebhookSecret(request: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET_KEY;
  if (!secret) return true; // If secret key is not set, allow requests

  const headerSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return headerSecret === secret;
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyWebhookSecret(request)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Invalid or missing webhook secret key" },
        { status: 401 }
      );
    }

    const payload = await request.json().catch(() => null);

    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request body payload" },
        { status: 400 }
      );
    }

    const automationResult = await executeLeadWebhookAutomation(payload);

    return NextResponse.json(automationResult, { status: automationResult.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal automation engine error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "online",
    service: "TEB Webhook Lead Automation Engine",
    timestamp: new Date().toISOString(),
    usage: {
      method: "POST",
      endpoint: "/api/webhooks/teb-lead",
      requiredHeader: "x-webhook-secret (if WEBHOOK_SECRET_KEY is configured)",
      bodySchema: {
        phone: "string (Required - e.g., '+1234567890')",
        "...otherFields": "Any lead properties to update in TEB",
      },
    },
  });
}
