import { tebRequest } from "@/lib/api/client";
import { acGetData } from "@/lib/api/dynamic";
import { liveAppUrl } from "@/lib/api/hosts";
import { listManageRecords } from "@/lib/api/manage-grid";
import type {
  QuoteCard,
  QuoteView,
  QuoteViewAction,
  QuoteViewItem,
  QuoteViewLine,
  QuoteViewNote,
  QuoteViewTemplate,
} from "@/lib/chat/types";
import { formatAmount, mappedCurrency } from "@/lib/money";

const QUOTE_MODULE = "TEBQuote";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrapUnknown(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return unwrapUnknown(JSON.parse(trimmed));
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return raw;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  const parsed = unwrapUnknown(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function asRecords(raw: unknown): Record<string, unknown>[] {
  const parsed = unwrapUnknown(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  const obj = asRecord(parsed);
  if (!obj) return [];
  for (const key of [
    "Data",
    "data",
    "Records",
    "QuoteDetail",
    "ItemDetail",
    "TotalSummary",
    "PaymentSummary",
    "Activity",
    "ActionDetail",
    "Notes",
    "value",
    "Value",
  ]) {
    const inner = asRecords(obj[key]);
    if (inner.length > 0) return inner;
  }
  if (obj.Id || obj.QuoteCode || obj.Title || obj.ItemName) return [obj];
  return [];
}

function asText(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return asText(obj.Value ?? obj.Text ?? obj.Name ?? obj.Title ?? obj.Label);
  }
  const text = String(value).trim();
  return text && text !== "[object Object]" ? text : "";
}

function firstText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = asText(row[key]);
    if (text) return text;
  }
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.replace(/,/g, "").trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function moneyText(value: unknown, symbol: string): string {
  const text = asText(value);
  if (!text) return "";
  if (/[^\d.,\s-]/.test(text)) return text;
  const n = asNumber(value);
  if (n == null) return text;
  return formatAmount(n, symbol);
}

function isTotalLine(title: string): boolean {
  return /^(grand\s*)?total(?:\s+amount)?$|amount (?:due|payable)|net (?:value|amount)|quote (?:net )?value$/i.test(
    title.trim(),
  );
}

export async function downloadQuoteTemplatePdf(entityId: string, templateId: string): Promise<string> {
  if (!entityId || !templateId) return "";
  const envelope = await tebRequest<string>("TEMPLATE", "AcDownloadPdf", {
    method: "POST",
    body: {
      data: {
        Module: "TEMPLATE",
        Code: "TEBQuote",
        Action: "SAVETEMPLATE",
        PrimaryKey: "",
        Data: JSON.stringify({ EntityId: entityId, Module: "TEBQuote", TemplateId: templateId }),
      },
    },
    timeoutMs: 45000,
  });
  return extractPdfUrl(envelope.Value ?? envelope.value ?? envelope.Data);
}

function extractPdfUrl(raw: unknown): string {
  const parsed = unwrapUnknown(raw);
  if (typeof parsed === "string") {
    const text = parsed.trim();
    if (/^https?:\/\//i.test(text)) return text;
    return "";
  }
  const obj = asRecord(parsed);
  if (!obj) return "";
  const nested = firstText(obj, ["Url", "FileUrl", "PdfUrl", "TemplateUrl", "Value", "Data"]);
  return /^https?:\/\//i.test(nested) ? nested : "";
}

function qtyText(value: unknown): string {
  const n = asNumber(value);
  if (n == null) return asText(value);
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function quoteOpenUrl(id: string): string {
  return liveAppUrl(`/sales/quote/view/${id}`);
}

export function isQuoteId(value: string): boolean {
  return GUID.test(value.trim());
}

export function toQuoteCard(row: Record<string, unknown>, preferredCurrency?: Record<string, unknown> | null): QuoteCard | null {
  const id = firstText(row, ["Id", "QuoteId", "id"]);
  if (!id) return null;
  const currency = mappedCurrency(row, preferredCurrency);
  const amount = asNumber(row.QuoteCurrentValue ?? row.QuoteNetValue ?? row.QuoteValue ?? row.NetAmount ?? row.TotalAmount);
  return {
    id,
    title: firstText(row, ["Title", "QuoteTitle", "Name"]) || "Untitled quote",
    code: firstText(row, ["QuoteCode", "Code"]),
    company: firstText(row, ["CompanyName"]) || undefined,
    contact: firstText(row, ["ContactName"]) || undefined,
    owner: firstText(row, ["OwnerName"]) || undefined,
    status: firstText(row, ["StatusName", "Status", "WorkFlow"]) || undefined,
    amountFormatted: amount == null ? undefined : formatAmount(amount, currency.symbol),
    openUrl: quoteOpenUrl(id),
  };
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseEnvelopeRecord(envelope: { Value?: string; value?: unknown; Data?: unknown }): Record<string, unknown> | null {
  const fromValue = asRecord(envelope.Value ?? envelope.value);
  if (fromValue && (fromValue.Id || fromValue.QuoteCode || fromValue.Title || fromValue.ItemDetail)) {
    return fromValue;
  }
  const fromData = asRecord(envelope.Data);
  if (fromData) {
    const nested = asRecord(fromData.Value ?? fromData.value) || fromData;
    if (nested.Id || nested.QuoteCode || nested.Title || nested.ItemDetail) return nested;
  }
  return fromValue ?? fromData;
}

export async function getQuoteDetail(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const envelope = await acGetData({
    Module: "EstimationManagement",
    Code: "QUOTE",
    PrimaryKey: id,
    Data: "",
    Action: "GETQUOTEDETAIL",
  });
  return parseEnvelopeRecord(envelope);
}

export async function getQuoteItems(id: string): Promise<{
  items: Record<string, unknown>[];
  summary: Record<string, unknown>[];
  payments: Record<string, unknown>[];
}> {
  const envelope = await acGetData({
    Module: "EstimationManagement",
    Code: "VIEWCONSUMEDITEM",
    PrimaryKey: id,
    Data: "",
    Action: "VIEWCONSUMEDITEM",
  });
  const payload = parseEnvelopeRecord(envelope) ?? asRecord(envelope.Value ?? envelope.Data) ?? {};
  return {
    items: asRecords(payload.ItemDetail),
    summary: asRecords(payload.TotalSummary),
    payments: asRecords(payload.PaymentSummary),
  };
}

export async function listQuoteTemplates(locationId?: string): Promise<QuoteViewTemplate[]> {
  const body: Record<string, unknown> = { Module: QUOTE_MODULE };
  if (locationId) body.LocationId = locationId;
  const envelope = await tebRequest<Record<string, unknown>[]>("MICRO", "gateway/common/getsubscribertemplatedropdown", {
    method: "POST",
    body,
  });
  const rows = asRecords(envelope.Data ?? envelope);
  const templates: QuoteViewTemplate[] = [];
  for (const row of rows) {
    const id = firstText(row, ["Id", "id"]);
    const name = firstText(row, ["Text", "Name", "Title", "SubText"]);
    if (!id && !name) continue;
    templates.push({
      id: id || name,
      name: name || "Template",
      isDefault: Boolean(row.IsDefault),
      isSelected: false,
    });
  }
  return templates;
}

export async function listQuoteNotes(id: string): Promise<QuoteViewNote[]> {
  const envelope = await tebRequest<Record<string, unknown>[]>("MICRO", "gateway/common/GetSubscriberNotes", {
    method: "POST",
    body: { data: { EntityId: id, Module: QUOTE_MODULE } },
  });
  const rows = asRecords(envelope.Data ?? envelope);
  const notes: QuoteViewNote[] = [];
  for (const [index, row] of rows.entries()) {
    const text = stripHtml(firstText(row, ["Description", "Note", "Notes", "Text"]));
    if (!text) continue;
    notes.push({
      id: firstText(row, ["Id", "NoteId"]) || `note-${index}`,
      text,
      author: firstText(row, ["CreatedByName", "CreatedBy", "UserName"]) || undefined,
      date: firstText(row, ["FormattedCreatedOn", "CreatedDate", "CreatedOn"]) || undefined,
      pinned: Boolean(row.IsPin || row.IsPinned),
    });
  }
  return notes;
}

export async function listQuoteActivity(id: string): Promise<QuoteViewAction[]> {
  const envelope = await acGetData({
    Module: "EstimationManagement",
    Code: "QUOTE",
    PrimaryKey: id,
    Data: "",
    Action: "GETQUOTEACTIVITY",
  });
  const rows = asRecords(envelope.Value ?? envelope.Data ?? envelope);
  return rows.map((row, index) => {
    const assignees = asRecords(row.AssigneeList)
      .map((item) => firstText(item, ["Name", "Text", "UserName", "Title"]))
      .filter(Boolean);
    const assignee = assignees.join(", ") || firstText(row, ["Assignee", "AssigneeName", "OwnerName"]);
    return {
      id: firstText(row, ["Id"]) || `action-${index}`,
      type: firstText(row, ["Type", "ActionType", "Title", "Name"]) || "Action",
      assignee: assignee || undefined,
      schedule: firstText(row, ["ScheduleDate", "FormattedScheduleDate", "DayType", "DueDate"]) || undefined,
    };
  });
}

export async function searchQuotes(needle: string, pageSize = 25): Promise<Record<string, unknown>[]> {
  const search = needle.trim();
  const page = await listManageRecords({
    module: "EstimationManagement",
    code: "MANAGE",
    action: "MANAGE",
    primaryKey: "Id",
    pageNumber: 0,
    pageSize,
    sortColumn: "modifieddate",
    sortOrder: true,
    fullTextSearch: search,
  });
  return page.rows as Record<string, unknown>[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

export function rankQuoteMatches(rows: Record<string, unknown>[], needle: string): Record<string, unknown>[] {
  const want = normalize(needle);
  if (!want) return rows;
  const scored = rows.map((row) => {
    const code = normalize(firstText(row, ["QuoteCode", "Code"]));
    const title = normalize(firstText(row, ["Title", "QuoteTitle"]));
    const company = normalize(firstText(row, ["CompanyName"]));
    let score = 0;
    if (code && code === want) score = 100;
    else if (title && title === want) score = 90;
    else if (code && code.includes(want)) score = 70;
    else if (title && title.includes(want)) score = 60;
    else if (company && company.includes(want)) score = 40;
    else if (`${code} ${title} ${company}`.includes(want)) score = 20;
    return { row, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.row);
}

function itemNamesFrom(row: Record<string, unknown>): string[] {
  const raw = row.ItemNames;
  if (Array.isArray(raw)) return raw.map((item) => asText(item)).filter(Boolean);
  const text = asText(raw);
  return text ? [text] : [];
}

function toItems(rows: Record<string, unknown>[], symbol: string): QuoteViewItem[] {
  return rows.map((row, index) => {
    const nested = asRecord(row.ItemPriceScheme) || asRecord(row.Item) || {};
    return {
      id: firstText(row, ["Id", "ItemId"]) || `item-${index}`,
      name:
        firstText(row, ["ItemName", "ProductName", "Name", "Title", "Description"]) ||
        firstText(nested, ["ItemName", "Name", "Title"]) ||
        "Item",
      sku: firstText(row, ["SKU", "ItemStandardCode", "ItemCode"]) || firstText(nested, ["SKU", "ItemCode"]) || undefined,
      quantity: qtyText(row.Quantity),
      unit: firstText(row, ["UnitName"]) || undefined,
      unitPrice: moneyText(row.UnitPrice ?? row.PricePerUnit, symbol),
      discount: moneyText(row.Discount ?? row.AppliedDiscount ?? row.TotalDiscount, symbol),
      tax: moneyText(row.Tax, symbol),
      netAmount: moneyText(row.NetAmount ?? row.TotalAmountWithTax ?? row.TotalAmount, symbol),
      brand: firstText(row, ["BrandName"]) || undefined,
      category: firstText(row, ["CategoryName"]) || undefined,
    };
  });
}

function toBreakdown(
  summary: Record<string, unknown>[],
  payments: Record<string, unknown>[],
  header: Record<string, unknown>,
  symbol: string,
): QuoteViewLine[] {
  const lines: QuoteViewLine[] = [...summary]
    .sort((a, b) => (asNumber(a.Sequence) ?? 0) - (asNumber(b.Sequence) ?? 0))
    .map((row) => {
      const title = firstText(row, ["Title", "Code"]) || "Total";
      return {
        title,
        value: moneyText(row.Value, symbol),
        emphasis: isTotalLine(title),
      };
    })
    .filter((row) => row.title && row.value);
  if (lines.length === 0) {
    const quoteValue = moneyText(header.QuoteValue, symbol);
    const netValue = moneyText(header.QuoteNetValue ?? header.QuoteCurrentValue, symbol);
    if (quoteValue) lines.push({ title: "Quote value", value: quoteValue, emphasis: !netValue });
    if (netValue && netValue !== quoteValue) lines.push({ title: "Net value", value: netValue, emphasis: true });
  } else if (!lines.some((row) => row.emphasis)) {
    lines[lines.length - 1] = { ...lines[lines.length - 1], emphasis: true };
  }
  for (const row of payments) {
    const title = firstText(row, ["Title", "Type"]) || "Payment";
    const value = moneyText(row.Total, symbol);
    if (title && value) lines.push({ title, value });
  }
  return lines;
}

const HEADER_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Company", keys: ["CompanyName"] },
  { label: "Contact", keys: ["ContactName"] },
  { label: "Owner", keys: ["OwnerName"] },
  { label: "Valid until", keys: ["ValidTill", "ValidFor", "ExpiryDate"] },
  { label: "Created", keys: ["CreatedDate", "FormattedCreatedOn"] },
  { label: "Modified", keys: ["ModifiedDate", "FormattedModifiedOn"] },
];

export function toQuoteView(
  header: Record<string, unknown>,
  extras: {
    items?: Record<string, unknown>[];
    summary?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    templates?: QuoteViewTemplate[];
    notes?: QuoteViewNote[];
    actions?: QuoteViewAction[];
    preferredCurrency?: Record<string, unknown> | null;
  } = {},
): QuoteView | null {
  const id = firstText(header, ["Id", "QuoteId", "id"]);
  if (!id) return null;
  const currency = mappedCurrency(header, extras.preferredCurrency);
  const selectedTemplateId = firstText(header, ["TemplateId"]);
  const templates = (extras.templates || []).map((row) => ({
    ...row,
    isSelected: Boolean(selectedTemplateId && row.id === selectedTemplateId) || (!selectedTemplateId && row.isDefault),
  }));
  const items = toItems(extras.items || [], currency.symbol);
  const names = itemNamesFrom(header);
  return {
    id,
    title: firstText(header, ["Title", "QuoteTitle", "Name"]) || "Untitled quote",
    code: firstText(header, ["QuoteCode", "Code"]),
    company: firstText(header, ["CompanyName"]) || undefined,
    contact: firstText(header, ["ContactName"]) || undefined,
    owner: firstText(header, ["OwnerName"]) || undefined,
    status: firstText(header, ["Status", "StatusName"]) || undefined,
    workflow: firstText(header, ["WorkFlow", "WorkflowName"]) || undefined,
    nextStatus: firstText(header, ["NextStatus"]) || undefined,
    closed: Boolean(header.IsQuoteClose),
    currencySymbol: currency.symbol,
    currencyCode: currency.code,
    openUrl: quoteOpenUrl(id),
    fields: HEADER_FIELDS.map((field) => ({ label: field.label, value: firstText(header, field.keys) })).filter(
      (field) => field.value,
    ),
    items,
    itemNames: names,
    templates,
    notes: extras.notes || [],
    actions: extras.actions || [],
    breakdown: toBreakdown(extras.summary || [], extras.payments || [], header, currency.symbol),
  };
}

export async function loadQuoteView(id: string, preferredCurrency?: Record<string, unknown> | null): Promise<QuoteView | null> {
  const header = await getQuoteDetail(id);
  if (!header) return null;
  const locationId = firstText(header, ["LocationId"]);
  const [itemsResult, templates, notes, actions] = await Promise.all([
    getQuoteItems(id).catch(() => ({ items: [] as Record<string, unknown>[], summary: [] as Record<string, unknown>[], payments: [] as Record<string, unknown>[] })),
    listQuoteTemplates(locationId).catch(() => [] as QuoteViewTemplate[]),
    listQuoteNotes(id).catch(() => [] as QuoteViewNote[]),
    listQuoteActivity(id).catch(() => [] as QuoteViewAction[]),
  ]);
  const notesSorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return toQuoteView(header, {
    items: itemsResult.items,
    summary: itemsResult.summary,
    payments: itemsResult.payments,
    templates,
    notes: notesSorted,
    actions,
    preferredCurrency,
  });
}
