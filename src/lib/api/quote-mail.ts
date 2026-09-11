import { tebRequest } from "@/lib/api/client";
import { asLookupOptions, type LookupOption } from "@/lib/api/quote-lookups";
import { acGetData, QUOTE_MODULE, type TebAcGetDataRequest } from "@/lib/api/quote";
import { TebApiError, type TebApiEnvelope } from "@/lib/api/types";

const MAIL_MODULE = "TEBQuote";

export interface QuoteMailDefaults {
  fromId: string;
  toMail: string;
  ccMail: string;
  bccMail: string;
  templateId: string;
  subject: string;
  message: string;
}

export interface QuoteMailPayload {
  quoteId: string;
  fromId: string;
  toMail: string;
  ccMail?: string;
  bccMail?: string;
  templateId?: string;
  subject: string;
  message: string;
  attachments?: string[];
}

function unwrapValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function decodeScalar(raw: unknown): string {
  let current: unknown = raw;
  for (let i = 0; i < 4; i += 1) {
    if (typeof current !== "string") break;
    const text = current.trim();
    if (!text || text === "null") return "";
    const wrapped =
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("[") && text.endsWith("]")) ||
      (text.startsWith("{") && text.endsWith("}"));
    if (!wrapped) return text.replace(/^"+|"+$/g, "");
    try {
      current = JSON.parse(text);
    } catch {
      return text.replace(/^"+|"+$/g, "");
    }
  }
  if (current == null || current === "null") return "";
  if (typeof current === "object") return "";
  return String(current).trim();
}

function looksLikeUrl(value: string): boolean {
  const text = value.trim();
  if (!text || text === "null") return false;
  if (/^(https?:)?\/\//i.test(text) || /^https?:/i.test(text)) return true;
  if (/^data:application\/pdf/i.test(text) || /^blob:/i.test(text)) return true;
  if (/\.pdf(\?|$)/i.test(text) && !/\s/.test(text)) return true;
  return false;
}

function idFromUnknown(raw: unknown, depth = 0): string {
  if (raw == null || depth > 6) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text || text === "null" || text === "[object Object]") return "";
    const unwrapped = unwrapValue(text);
    if (unwrapped !== text) return idFromUnknown(unwrapped, depth + 1);
    if (text.startsWith("{") || text.startsWith("[")) return "";
    return text.replace(/^"+|"+$/g, "");
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = idFromUnknown(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    for (const key of ["Id", "id", "TemplateId", "templateId"]) {
      if (key in row) {
        const found = idFromUnknown(row[key], depth + 1);
        if (found) return found;
      }
    }
    if ("Value" in row) return idFromUnknown(row.Value, depth + 1);
    if ("value" in row) return idFromUnknown(row.value, depth + 1);
  }
  return "";
}

const GENERIC_TEMPLATE_ERROR = /something went wrong, please contact/i;

function pdfSrcFromString(text: string): string {
  const trimmed = text.trim().replace(/^"+|"+$/g, "");
  if (!trimmed || trimmed === "null" || GENERIC_TEMPLATE_ERROR.test(trimmed)) return "";
  if (looksLikeUrl(trimmed)) return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (trimmed.startsWith("%PDF")) {
    const bytes = typeof btoa === "function" ? btoa(trimmed) : "";
    return bytes ? `data:application/pdf;base64,${bytes}` : "";
  }
  if (/^JVBERi0/i.test(trimmed)) {
    return `data:application/pdf;base64,${trimmed.replace(/\s/g, "")}`;
  }
  return "";
}

function urlFromUnknown(raw: unknown, depth = 0): string {
  if (raw == null || depth > 6) return "";
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text || text === "null") return "";
    const direct = pdfSrcFromString(text);
    if (direct) return direct;
    const unwrapped = unwrapValue(text);
    if (unwrapped !== text) return urlFromUnknown(unwrapped, depth + 1);
    return "";
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = urlFromUnknown(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    for (const key of [
      "Url",
      "URL",
      "fileUrl",
      "FileUrl",
      "PdfUrl",
      "TemplateUrl",
      "DownloadUrl",
      "SignedUrl",
      "BlobUrl",
      "FilePath",
      "Path",
      "FileContent",
      "Base64",
      "Content",
      "Value",
      "value",
      "Data",
    ]) {
      if (key in row) {
        const found = urlFromUnknown(row[key], depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(row)) {
      const found = urlFromUnknown(value, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function envelopeFailed(envelope: TebApiEnvelope, fallback: string): void {
  if (envelope.Succeeded === false) {
    throw new TebApiError(
      (Array.isArray(envelope.Messages) && envelope.Messages[0]) || envelope.error || envelope.message || fallback,
      400,
      envelope,
    );
  }
  if (typeof envelope.Data === "string" && /please update your application/i.test(envelope.Data)) {
    throw new TebApiError(envelope.Data, 400, envelope);
  }
}

function controlsFromMailValue(raw: unknown): Array<{ Control?: string; Value?: unknown }> {
  let current = unwrapValue(raw);
  for (let i = 0; i < 3; i += 1) current = unwrapValue(current);
  const rows: unknown[] = Array.isArray(current) ? current : [];
  const flat: Array<{ Control?: string; Value?: unknown }> = [];
  const walk = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (item && typeof item === "object" && "Control" in item) {
      flat.push(item as { Control?: string; Value?: unknown });
    }
  };
  walk(rows);
  return flat;
}

export async function getQuoteMailDefaults(quoteId: string): Promise<QuoteMailDefaults> {
  const envelope = await acGetData({
    Module: QUOTE_MODULE.estimation,
    Code: "QUOTEMAIL",
    PrimaryKey: quoteId,
    Data: "",
    Action: "GETMAILDETAIL",
  });
  const controls = controlsFromMailValue(envelope.Value ?? envelope.value ?? envelope.Data);
  const valueOf = (name: string) => {
    const row = controls.find((item) => String(item.Control ?? "").toLowerCase() === name.toLowerCase());
    return decodeScalar(row?.Value);
  };
  const templateRaw = controls.find((item) => /^(template|templateid)$/i.test(String(item.Control ?? "")))?.Value;
  const templateId = idFromUnknown(templateRaw) || decodeScalar(templateRaw);
  return {
    fromId: valueOf("FromId") || valueOf("From"),
    toMail: valueOf("ToMail") || valueOf("To"),
    ccMail: valueOf("CcMail") || valueOf("Cc"),
    bccMail: valueOf("BccMail") || valueOf("Bcc"),
    templateId,
    subject: valueOf("Subject"),
    message: valueOf("Message") || valueOf("Body"),
  };
}

async function microLookup(path: string, body: Record<string, unknown>): Promise<LookupOption[]> {
  const envelope = await tebRequest("MICRO", path, { method: "POST", body });
  envelopeFailed(envelope, "Could not load options.");
  return asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value);
}

export async function listQuoteFromEmails(locationId = ""): Promise<LookupOption[]> {
  return microLookup("gateway/common/GetVerifiedFromEmails", {
    Modules: MAIL_MODULE,
    LocationId: locationId,
  });
}

export async function listQuoteTemplates(locationId = ""): Promise<LookupOption[]> {
  const attempts: Array<Record<string, unknown>> = [
    { Module: MAIL_MODULE, LocationId: locationId },
    { Module: MAIL_MODULE, LocationId: "" },
    { Module: QUOTE_MODULE.estimation, LocationId: locationId },
  ];
  for (const body of attempts) {
    try {
      const rows = await microLookup("gateway/common/getsubscribertemplatedropdown", body);
      if (rows.length > 0) return rows;
    } catch {
      // MICRO 426 / empty — try the next Module / LocationId pair.
    }
  }
  return [];
}

async function templatePdf(action: "SAVETEMPLATE" | "DOWNLOADTEMPLATE", quoteId: string, templateId: string): Promise<string> {
  const id = idFromUnknown(templateId);
  if (!id) throw new TebApiError("Select a template first.", 400);

  // Live QUOTEMAIL uses AcDownloadPdf + a2.EstimationManagement (TEBQuote).
  // View tab uses the same payload with Method AcDownLoadPdf (capital L).
  // EstimationManagement 500s with the admin message on this host — try it last, and never
  // abort the whole run on the first failed attempt.
  const attempts: Array<{ path: string; code: string; module: string }> = [
    { path: "AcDownloadPdf", code: MAIL_MODULE, module: MAIL_MODULE },
    { path: "AcDownLoadPdf", code: MAIL_MODULE, module: MAIL_MODULE },
    { path: "AcDownloadPdf", code: MAIL_MODULE, module: QUOTE_MODULE.estimation },
    { path: "AcDownLoadPdf", code: MAIL_MODULE, module: QUOTE_MODULE.estimation },
    { path: "AcDownloadPdf", code: QUOTE_MODULE.estimation, module: QUOTE_MODULE.estimation },
    { path: "AcDownLoadPdf", code: QUOTE_MODULE.estimation, module: QUOTE_MODULE.estimation },
  ];
  let lastError: TebApiError | null = null;
  let sawOkWithoutUrl = false;
  for (const attempt of attempts) {
    const payload: TebAcGetDataRequest = {
      Module: "TEMPLATE",
      Code: attempt.code,
      PrimaryKey: quoteId,
      Data: JSON.stringify({
        EntityId: quoteId,
        Module: attempt.module,
        TemplateId: id,
      }),
      Action: action,
    };
    try {
      const envelope = await tebRequest<string>("TEMPLATE", attempt.path, {
        method: "POST",
        body: { data: payload },
        timeoutMs: 60000,
      });
      if (envelope.Succeeded === false) {
        lastError = new TebApiError(
          (Array.isArray(envelope.Messages) && envelope.Messages[0]) ||
            envelope.error ||
            envelope.message ||
            "Could not generate the quote template.",
          400,
          envelope,
        );
        continue;
      }
      const url = urlFromUnknown(envelope);
      if (url) return url;
      sawOkWithoutUrl = true;
      const raw = envelope.Value ?? envelope.value ?? envelope.Data;
      if (typeof raw === "string" && GENERIC_TEMPLATE_ERROR.test(raw)) {
        lastError = new TebApiError(raw, 400, envelope);
      }
    } catch (err) {
      lastError = err instanceof TebApiError ? err : new TebApiError("Could not generate the quote template.", 500);
    }
  }
  if (sawOkWithoutUrl && (!lastError || GENERIC_TEMPLATE_ERROR.test(lastError.message))) {
    throw new TebApiError("Template URL was not returned.", 400);
  }
  throw lastError ?? new TebApiError("Template URL was not returned.", 400);
}

export async function previewQuoteTemplate(quoteId: string, templateId: string): Promise<string> {
  return templatePdf("SAVETEMPLATE", quoteId, templateId);
}

export async function downloadQuoteTemplate(quoteId: string, templateId: string): Promise<string> {
  try {
    return await templatePdf("DOWNLOADTEMPLATE", quoteId, templateId);
  } catch {
    return previewQuoteTemplate(quoteId, templateId);
  }
}

export async function sendQuoteMail(input: QuoteMailPayload): Promise<string> {
  const body = {
    EntityId: input.quoteId,
    Module: MAIL_MODULE,
    FromId: input.fromId,
    ToMail: input.toMail,
    CcMail: input.ccMail ?? "",
    BccMail: input.bccMail ?? "",
    Template: input.templateId ?? "",
    Subject: input.subject,
    Message: input.message,
    Attachments: input.attachments ?? [],
  };
  const envelope = await tebRequest<string>("MICRO", "gateway/quote/SendMailToCustomers", {
    method: "POST",
    body,
    timeoutMs: 30000,
  });
  envelopeFailed(envelope, "Could not send the email.");
  if (envelope.Succeeded === false) {
    throw new TebApiError(
      (Array.isArray(envelope.Messages) && envelope.Messages[0]) || "Could not send the email.",
      400,
      envelope,
    );
  }
  const message = envelope.Data ?? envelope.message ?? envelope.Message;
  return typeof message === "string" && message.trim() ? message : "Email sent.";
}
