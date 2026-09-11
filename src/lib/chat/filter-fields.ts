import type { FilterCriterion, FilterTab } from "@/lib/chat/types";

/** Spoken names → live GetFilterControls Tab.Code / Title tokens. Same map works for other apps. */
export const FILTER_ALIASES: Record<string, string[]> = {
  owner: ["owner", "owners", "owned by", "ownedby"],
  assignee: ["assignee", "assignees", "assigned to", "assignedto", "assign"],
  status: ["status", "stage", "stages"],
  workflow: ["workflow", "pipeline"],
  location: ["location", "site", "sites"],
  source: ["source", "lead source", "leadsource", "sourcename", "source name"],
  sourcecategory: ["source category", "sourcecategory"],
  industry: ["industry", "industries"],
  sector: ["sector", "sectors"],
  tag: ["tag", "tags"],
  company: ["company", "companies", "company name", "account"],
  contacttype: ["contact type", "contacttype"],
  relationship: ["relationship", "relationship type", "relationshiptype"],
  referral: ["referral", "referral source", "refralsource"],
  priority: ["priority", "internal priority"],
  channel: ["channel", "channels"],
  type: ["type", "lead type", "opportunity type", "quote type", "order type", "invoice type", "action type", "task type", "actiontype", "ticket type", "work order type", "wo type"],
  title: ["title", "action title", "task title", "ticket title", "work order title"],
  related: ["related to", "related", "linked to", "module"],
  ticketcode: ["ticket no", "ticket number", "ticket code", "ticketcode"],
  workordercode: ["work order no", "work order number", "work order code", "wo no", "wo number", "wocode", "workordercode"],
  asset: ["asset", "assets", "equipment"],
  sla: ["sla", "sla status"],
  item: ["item", "items", "product", "products"],
  category: ["category", "categories", "item category"],
  brand: ["brand", "brands"],
  sku: ["sku", "skus", "item code", "itemcode"],
  model: ["model", "models"],
  currency: ["currency", "currencies"],
  contact: ["contact", "contacts"],
  billinglocation: ["billing location", "billing site", "billing"],
  shippinglocation: ["shipping location", "shipping site", "shipping"],
  quotecode: ["quote no", "quote number", "quote code", "quotecode"],
  ordercode: ["order no", "order number", "order code", "ordercode", "po number", "po no"],
  invoicecode: ["invoice no", "invoice number", "invoice code", "invoicecode", "bill no", "bill number"],
  validfor: ["valid for", "valid till", "valid until", "expiry", "expires"],
  expected: ["expected", "expected by", "expected date"],
  delivery: ["delivery", "delivery date", "delivered"],
  payment: ["payment", "payment status", "paid"],
  warehouse: ["warehouse", "store", "godown"],
  due: ["due", "due date", "overdue"],
  tax: ["tax", "gst", "vat"],
};

const DATE_STOP = /\b(created|updated|modified|closed|scheduled|schedule|due|this|last|today|yesterday|in the|between|owned|assigned)\b/i;

export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

export function aliasFamily(hint: string): string {
  const compact = normalizeKey(hint);
  for (const [family, aliases] of Object.entries(FILTER_ALIASES)) {
    if (normalizeKey(family) === compact) return family;
    if (aliases.some((alias) => normalizeKey(alias) === compact)) return family;
  }
  return compact;
}

export function splitFilterValues(raw: string): string[] {
  const cut = raw
    .replace(/[?.!]+$/, "")
    .replace(/\s+(created|updated|modified|closed|scheduled|schedule|due|this|last|today|yesterday|owned|assigned|where)\b.*$/i, "")
    .replace(DATE_STOP, "")
    .trim();
  return cut
    .split(/\s*(?:,|;|\bor\b|\band\b)\s*/i)
    .map((part) => part.replace(/^["']|["']$/g, "").trim())
    .filter((part) => part.length > 0 && !/^(me|my|mine|the|a|an)$/i.test(part));
}

export function parseCriteria(text: string): FilterCriterion[] {
  const field = Object.values(FILTER_ALIASES)
    .flat()
    .sort((a, b) => b.length - a.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(
    `\\b(?:where\\s+)?(${field})\\s*(?:=|is|are|:|in)\\s+([^?]+?)(?=\\s+(?:(?:and|or)\\s+)?(?:where\\s+)?(?:${field})\\s*(?:=|is|are|:|in)|\\s+${DATE_STOP.source}|$)`,
    "gi",
  );
  const rows: FilterCriterion[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const key = aliasFamily(match[1] || "");
    const chunk = match[2] || "";
    const me = /\bme\b/i.test(chunk) && /^(owner|assignee)$/.test(key);
    const values = splitFilterValues(chunk.replace(/\bme\b/gi, ""));
    if (!key || (!me && values.length === 0)) continue;
    const stamp = `${key}:${me ? "me" : values.join("|")}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    rows.push({ key, values, me });
  }
  return rows;
}

export function mergeCriteria(intentCriteria: FilterCriterion[], extras: FilterCriterion[]): FilterCriterion[] {
  const merged = [...intentCriteria];
  for (const extra of extras) {
    const family = aliasFamily(extra.key);
    const existing = merged.find((row) => aliasFamily(row.key) === family);
    if (!existing) {
      merged.push({ ...extra, key: family });
      continue;
    }
    existing.me = existing.me || extra.me;
    for (const value of extra.values) {
      if (!existing.values.some((row) => row.toLowerCase() === value.toLowerCase())) existing.values.push(value);
    }
  }
  return merged;
}

export function matchTab(tabs: FilterTab[], hint: string): FilterTab | null {
  const family = aliasFamily(hint);
  const compact = normalizeKey(hint);
  const scored = tabs
    .map((tab) => {
      const code = normalizeKey(tab.Code || "");
      const title = normalizeKey(tab.Title || "");
      let score = 0;
      if (code === compact || title === compact) score = 3;
      else if (code.includes(compact) || title.includes(compact) || compact.includes(code)) score = 2;
      else if (aliasFamily(tab.Code || "") === family || aliasFamily(tab.Title || "") === family) score = 2;
      else if (family === "status" && (code.includes("status") || code.includes("stage") || code.includes("workflow"))) {
        score = code.includes("workflow") ? 1 : 2;
      }       else if (family === "item" && (code === "item" || title === "item")) {
        score = 3;
      } else if (family === "item" && code.includes("item") && !code.includes("opportunity") && !code.includes("quote")) {
        score = 2;
      }
      if (family === "related" && (code.includes("module") || title.includes("related") || title.includes("module"))) {
        score = Math.max(score, 2);
      }
      if (family === "type" && (code.includes("actiontype") || title.includes("actiontype"))) {
        score = Math.max(score, 3);
      }
      if (family === "type" && (code.includes("tickettype") || title.includes("tickettype"))) {
        score = Math.max(score, 3);
      }
      if (family === "type" && (code.includes("workordertype") || title.includes("workordertype"))) {
        score = Math.max(score, 3);
      }
      if (family === "asset" && (code.includes("asset") || title.includes("asset") || title.includes("equipment"))) {
        score = Math.max(score, 3);
      }
      if (family === "type" && (String(tab.TabViewType || "").toUpperCase() === "DATEVIEW" || title.includes("created"))) {
        score = 0;
      }
      return { tab, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.tab ?? null;
}

export function tabPhrases(tab: FilterTab): string[] {
  const title = (tab.Title || tab.Code || "").trim();
  if (!title) return [];
  const code = String(tab.Code || "").toUpperCase();
  if (code.includes("DATE") || tab.TabViewType === "DATEVIEW") {
    return [`${title} last 7 days`, `${title} this month`];
  }
  return [`where ${title.toLowerCase()} = …`];
}

/** “with item iPhone”, “for items A, B” — same item stack Quote/Order/Invoice use. */
export function parseItemPhrases(text: string): FilterCriterion[] {
  const rows: FilterCriterion[] = [];
  const withItem = text.match(/\b(?:with|containing|for)\s+items?\s+([a-z0-9][\w ./-]{1,80})/i);
  if (withItem?.[1]) rows.push({ key: "item", values: splitFilterValues(withItem[1]) });
  const withSku = text.match(/\b(?:with|containing|for)\s+skus?\s+([a-z0-9][\w ./-]{1,80})/i);
  if (withSku?.[1]) rows.push({ key: "sku", values: splitFilterValues(withSku[1]) });
  const withAsset = text.match(/\b(?:with|containing|for)\s+assets?\s+([a-z0-9][\w ./-]{1,80})/i);
  if (withAsset?.[1]) rows.push({ key: "asset", values: splitFilterValues(withAsset[1]) });
  return rows;
}
