import { tebRequest } from "@/lib/api/client";
import { acGetData } from "@/lib/api/dynamic";
import { searchCompanies, searchContacts, type LookupOption } from "@/lib/api/quote-lookups";
import type { FilterValueRow, LiveDateFilter, PartyCard, PartyChannel, PartyProfile } from "@/lib/chat/types";

export type PartyKind = "COMPANY" | "CONTACT";
export type { PartyCard, PartyChannel, PartyProfile };

export interface PartyListQuery {
  kind: PartyKind;
  search?: string;
  pageSize?: number;
  filterId?: string | null;
  filterValues?: FilterValueRow[] | null;
  dateFilter?: LiveDateFilter | null;
  ownerIds?: string[];
}

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
  for (const key of ["Data", "data", "Records", "CompanyContacts", "ContactDetail", "CompanyDetail", "value", "Value"]) {
    const inner = asRecords(obj[key]);
    if (inner.length > 0) return inner;
  }
  if (obj.Id || obj.CompanyName || obj.FullName) return [obj];
  return [];
}

function asText(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return asText(obj.Value ?? obj.Text ?? obj.Name ?? obj.Title ?? obj.Email ?? obj.Phone);
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

/** GETCOMPANYDETAIL / GETCONTACTDETAIL put a UserId in OwnerName; the list API returns the person name. */
function looksLikeRecordId(value: string): boolean {
  const text = value.trim();
  if (!text || /\s/.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  if (/^[0-9a-f]{24}$/i.test(text)) return true;
  return false;
}

export function ownerDisplayName(row: Record<string, unknown>, owners?: LookupOption[]): string {
  const named = firstText(row, ["OwnerName", "Owner"]);
  if (named && !looksLikeRecordId(named)) return named;
  const ids = [firstText(row, ["OwnerId", "ownerid"]), named].filter((value) => looksLikeRecordId(value));
  for (const id of ids) {
    const hit = owners?.find((option) => option.id === id);
    if (hit?.label && !looksLikeRecordId(hit.label)) return hit.label;
  }
  return "";
}

export function partyKindFromEntity(key: "company" | "contact"): PartyKind {
  return key === "contact" ? "CONTACT" : "COMPANY";
}

export function partyDisplayName(row: Record<string, unknown>): string {
  return (
    firstText(row, ["FullName", "CompanyName", "Name", "Text", "Title", "DisplayName", "CompanyCode"]) || "Untitled"
  );
}

function telHref(value: string): string | null {
  const compact = value.replace(/[^\d+]/g, "");
  const digits = compact.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${compact.startsWith("+") ? `+${compact.replace(/\D/g, "")}` : digits}`;
}

function mailtoHref(value: string): string | null {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return `mailto:${email}`;
}

function collectChannels(
  row: Record<string, unknown>,
  kind: "phone" | "email",
  listKey: string,
  scalarKeys: string[],
): PartyChannel[] {
  const seen = new Set<string>();
  const channels: PartyChannel[] = [];
  const push = (title: string, raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const href = kind === "phone" ? telHref(value) : mailtoHref(value);
    if (!href) return;
    const stamp = value.toLowerCase();
    if (seen.has(stamp)) return;
    seen.add(stamp);
    channels.push({ kind, title: title || (kind === "phone" ? "Phone" : "Email"), value, href });
  };

  for (const item of asRecords(row[listKey])) {
    const value = firstText(item, ["Value", "Email", "Phone", "Mobile", "Text"]);
    const title = firstText(item, ["Title", "Type", "Label", "Name"]);
    push(title, value);
  }
  for (const key of scalarKeys) {
    push(kind === "phone" ? "Phone" : "Email", asText(row[key]));
  }
  return channels;
}

export function extractPhones(row: Record<string, unknown>): PartyChannel[] {
  return collectChannels(row, "phone", "PhoneDetail", ["Phone", "Mobile", "MobileNumber", "WorkPhone"]);
}

export function extractEmails(row: Record<string, unknown>): PartyChannel[] {
  return collectChannels(row, "email", "EmailDetail", ["Email", "EmailId", "WorkEmail"]);
}

export function toPartyCard(row: Record<string, unknown>, kind: PartyKind, owners?: LookupOption[]): PartyCard | null {
  const id = firstText(row, ["Id", "id", "CompanyId", "ContactId"]);
  if (!id) return null;
  const name = partyDisplayName(row);
  const companyName = firstText(row, ["CompanyName"]);
  const subtitle =
    kind === "CONTACT"
      ? companyName && companyName !== name
        ? companyName
        : firstText(row, ["JobTitle", "ContactTypeName"])
      : firstText(row, ["CompanyCode", "IndustryName"]);
  return {
    id,
    kind: kind === "CONTACT" ? "contact" : "company",
    name,
    subtitle: subtitle || undefined,
    owner: ownerDisplayName(row, owners) || undefined,
    location: firstText(row, ["LocationName", "CompanyLocationName", "City", "Address"]) || undefined,
    industry: firstText(row, ["IndustryName", "SectorName"]) || undefined,
    phones: extractPhones(row),
    emails: extractEmails(row),
  };
}

const PROFILE_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Code", keys: ["CompanyCode"] },
  { label: "Job title", keys: ["JobTitle"] },
  { label: "Owner", keys: ["OwnerName"] },
  { label: "Location", keys: ["LocationName", "CompanyLocationName"] },
  { label: "Address", keys: ["Address", "Address1"] },
  { label: "Industry", keys: ["IndustryName"] },
  { label: "Sector", keys: ["SectorName"] },
  { label: "Type", keys: ["ContactTypeName"] },
  { label: "Relationship", keys: ["RelationShipTypeNames", "RelationshipType"] },
  { label: "Source", keys: ["SourceName"] },
  { label: "Company", keys: ["CompanyName"] },
  { label: "Registration", keys: ["RegistrationNumber"] },
  { label: "Currency", keys: ["CurrencyName"] },
  { label: "Created", keys: ["CreatedDate"] },
];

function relatedRows(row: Record<string, unknown>): Record<string, unknown>[] {
  const related = [
    ...asRecords(row.CompanyContacts),
    ...asRecords(row.ContactDetail),
    ...asRecords(row.Contact),
  ];
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const item of related) {
    const id = firstText(item, ["Id", "ContactId", "CompanyId"]);
    const stamp = id || partyDisplayName(item);
    if (!stamp || seen.has(stamp)) continue;
    seen.add(stamp);
    unique.push(item);
  }
  return unique;
}

export function toPartyProfile(row: Record<string, unknown>, kind: PartyKind, owners?: LookupOption[]): PartyProfile | null {
  const card = toPartyCard(row, kind, owners);
  if (!card) return null;
  const fields: Array<{ label: string; value: string }> = [];
  const used = new Set<string>();
  for (const field of PROFILE_FIELDS) {
    if (kind === "COMPANY" && field.label === "Company") continue;
    const value = field.label === "Owner" ? ownerDisplayName(row, owners) : firstText(row, field.keys);
    if (!value || used.has(field.label) || value === card.name) continue;
    used.add(field.label);
    fields.push({ label: field.label, value });
  }
  const relatedKind: PartyKind = kind === "COMPANY" ? "CONTACT" : "CONTACT";
  return {
    ...card,
    fields,
    related: relatedRows(row)
      .map((item) => toPartyCard(item, relatedKind, owners))
      .filter((item): item is PartyCard => Boolean(item)),
    companyId: firstText(row, ["CompanyId"]) || undefined,
    companyName: firstText(row, ["CompanyName"]) || undefined,
  };
}

export async function listCustomers(query: PartyListQuery): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const data: Record<string, unknown> = {
    IsActive: true,
    FilterId: query.filterId ?? null,
    FullTextSearch: query.search || "",
    BusinessType: query.kind,
  };
  if (query.filterValues?.length) data.FilterValues = query.filterValues;
  if (query.dateFilter) data.DateFilter = query.dateFilter;
  if (query.ownerIds?.length) {
    data.OwnerAssigneeFilter = { Owners: query.ownerIds, Assignees: [] };
  }
  const envelope = await tebRequest<Record<string, unknown>[]>("MICRO", "gateway/Contact/GetCustomerDetail", {
    method: "POST",
    timeoutMs: 30000,
    body: {
      Data: data,
      PageNumber: 0,
      PageSize: Math.min(Math.max(query.pageSize ?? 25, 5), 50),
      SortColumn: "modifieddate",
      SortOrder: true,
    },
  });
  const rows = asRecords(envelope.Data ?? envelope);
  const totalRaw = Number(envelope.TotalCount ?? asRecord(envelope)?.TotalCount);
  return {
    rows,
    total: Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : rows.length,
  };
}

export async function searchParties(kind: PartyKind, keyword: string, parentId?: string): Promise<LookupOption[]> {
  if (!keyword.trim()) return [];
  return kind === "CONTACT"
    ? searchContacts(keyword.trim(), { parentId })
    : searchCompanies(keyword.trim(), { parentId });
}

function parseProfileEnvelope(envelope: { Value?: string; value?: unknown; Data?: unknown }): Record<string, unknown> | null {
  const fromValue = asRecord(envelope.Value ?? envelope.value);
  if (fromValue && (fromValue.Id || fromValue.CompanyName || fromValue.FullName || fromValue.PhoneDetail)) {
    return fromValue;
  }
  const fromData = asRecord(envelope.Data);
  if (fromData) {
    const nested = asRecord(fromData.Value ?? fromData.value) || fromData;
    if (nested.Id || nested.CompanyName || nested.FullName || nested.PhoneDetail) return nested;
  }
  const rows = asRecords(envelope.Data ?? envelope.Value ?? envelope.value);
  return rows[0] ?? fromValue ?? fromData;
}

export async function getPartyDetail(kind: PartyKind, id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const envelope = await acGetData({
    Module: "BusinessContactManagement",
    Code: kind,
    PrimaryKey: id,
    Data: "",
    Action: kind === "CONTACT" ? "GETCONTACTDETAIL" : "GETCOMPANYDETAIL",
  });
  return parseProfileEnvelope(envelope);
}

export async function listReportingCustomers(
  kind: PartyKind,
  pageSize: number,
  dateFilter?: LiveDateFilter | null,
): Promise<{ rows: Record<string, unknown>[]; total: number } | null> {
  const data: Record<string, unknown> = {
    BusinessType: kind,
    PageNumber: 0,
    PageSize: Math.min(Math.max(pageSize, 5), 50),
  };
  if (dateFilter) data.DateFilter = dateFilter;
  try {
    const envelope = await tebRequest("MICRO", "gateway/reporting/GetTeamAndMemberBasedCustomerDetails", {
      method: "POST",
      timeoutMs: 30000,
      body: { Data: data },
    });
    const rows = asRecords(envelope.Data ?? envelope);
    const totalRaw = Number(envelope.TotalCount ?? asRecord(envelope.Data)?.TotalCount);
    return {
      rows,
      total: Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : rows.length,
    };
  } catch {
    return null;
  }
}
