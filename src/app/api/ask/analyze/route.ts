import { NextRequest, NextResponse } from "next/server";
import type { DatasetSummary } from "@/lib/chat/types";

export const dynamic = "force-dynamic";

function formatMoney(value: number, symbol: string): string {
  const number = (Number.isFinite(value) ? value : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return symbol ? `${symbol} ${number}` : number;
}

function bucket(points: Array<{ label: string; value: number }>, summary: DatasetSummary) {
  return points.map((point) => ({
    label: point.label,
    value: summary.metric === "value" ? formatMoney(point.value, summary.currencySymbol) : point.value,
  }));
}

function analysisPayload(summary: DatasetSummary) {
  const symbol = summary.currencySymbol || "";
  const code = summary.currencyCode || "";
  return {
    currencyCode: code,
    currencySymbol: symbol,
    metric: summary.metric,
    totalRecords: summary.total,
    shown: summary.shown,
    amount: formatMoney(summary.amount, symbol),
    byStatus: bucket(summary.byStatus, summary),
    byOwner: bucket(summary.byOwner, summary),
    byMonth: bucket(summary.byMonth, summary),
    sample: summary.sample.map((row) => ({
      title: row.title,
      owner: row.owner,
      status: row.status,
      amount: row.amountFormatted || formatMoney(row.amount, symbol),
      date: row.date,
    })),
  };
}

function priorConversation(history: Array<{ role?: string; text?: string }> | undefined): string {
  if (!history?.length) return "";
  const lines = history
    .filter((row) => row.text?.trim())
    .slice(-8)
    .map((row) => `${row.role === "assistant" ? "Assistant" : "User"}: ${String(row.text).slice(0, 400)}`);
  if (!lines.length) return "";
  return `Prior conversation (grounding only; the dataset JSON is the source of truth):\n${lines.join("\n")}`;
}

function promptFor(
  question: string,
  summary: DatasetSummary,
  history?: Array<{ role?: string; text?: string }>,
): string {
  const code = summary.currencyCode || "the mapped subscriber currency";
  const symbol = summary.currencySymbol || code;
  return [
    "You are a TEB Cloud sales analyst. Use only the numbers in the JSON. Do not invent records.",
    "Write 4-6 sentences: what the filtered set shows, the main split, a trend if months exist, and one risk or follow-up.",
    `Subscriber currency is ${code} (${symbol}). Copy money strings exactly as given (they already include ${symbol}).`,
    `Never write $, USD, dollars, or US currency unless currencyCode is USD. Never invent a currency.`,
    priorConversation(history),
    `User question: ${question}`,
    `Dataset JSON: ${JSON.stringify(analysisPayload(summary))}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function enforceMappedCurrency(text: string, summary: DatasetSummary): string {
  const symbol = summary.currencySymbol;
  const code = summary.currencyCode;
  if (!text || !symbol || code === "USD" || symbol === "$") return text;
  return text
    .replace(/USD\s*\$/gi, symbol)
    .replace(/\$\s*(?=\d)/g, `${symbol} `)
    .replace(/\bUSD\b/g, code || symbol)
    .replace(/\bUS dollars?\b/gi, code || "the mapped currency")
    .replace(/\bdollars?\b/gi, code || "the mapped currency");
}

async function openAiAnalysis(
  question: string,
  summary: DatasetSummary,
  history?: Array<{ role?: string; text?: string }>,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You analyse CRM datasets. Be concrete and numeric. Currency is ${summary.currencyCode || "mapped"} (${summary.currencySymbol || ""}). Never use $ unless that currency is USD.`,
        },
        { role: "user", content: promptFor(question, summary, history) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 240) || `OpenAI ${res.status}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || null;
}

async function anthropicAnalysis(
  question: string,
  summary: DatasetSummary,
  history?: Array<{ role?: string; text?: string }>,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-haiku-20241022";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [{ role: "user", content: promptFor(question, summary, history) }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 240) || `Anthropic ${res.status}`);
  }
  const json = (await res.json()) as { content?: Array<{ text?: string }> };
  return json.content?.map((part) => part.text || "").join("\n").trim() || null;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    question?: string;
    summary?: DatasetSummary;
    history?: Array<{ role?: string; text?: string }>;
  };
  if (!body.question || !body.summary) {
    return NextResponse.json({ error: "question and summary are required" }, { status: 400 });
  }
  try {
    const raw =
      (await openAiAnalysis(body.question, body.summary, body.history)) ??
      (await anthropicAnalysis(body.question, body.summary, body.history));
    if (!raw) {
      return NextResponse.json({
        analysis: "",
        provider: "none",
        hint: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local for GenAI analysis.",
      });
    }
    return NextResponse.json({
      analysis: enforceMappedCurrency(raw, body.summary),
      provider: process.env.OPENAI_API_KEY ? "openai" : "anthropic",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
