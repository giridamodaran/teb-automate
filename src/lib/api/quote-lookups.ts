import { getSubscriberUsers } from "@/lib/auth/session";
import { tebRequest } from "@/lib/api/client";
import type { TebUserDetail } from "@/lib/api/types";
import { cacheCurrencyList } from "@/lib/money";
import { acGetData } from "@/lib/api/dynamic";

export interface LookupOption {
  id: string;
  label: string;
  extra?: Record<string, unknown>;
}

export interface PartySearchOptions {
  isAll?: boolean;
  parentId?: string;
}

function collectArrays(raw: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(raw)) {
    found.push(raw);
    return found;
  }
  if (typeof raw === "string") {
    try {
      return collectArrays(JSON.parse(raw), found);
    } catch {
      return found;
    }
  }
  if (!raw || typeof raw !== "object") return found;
  const obj = raw as Record<string, unknown>;
  for (const key of ["value", "Data", "Value", "Sites", "Workflows", "Users", "ContactDetail", "CompanyDetail"]) {
    if (key in obj) collectArrays(obj[key], found);
  }
  return found;
}

function unwrapList(raw: unknown): unknown[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.value) && obj.value.length > 0) return obj.value;
    if (Array.isArray(obj.Data) && obj.Data.length > 0) return obj.Data;
    if (Array.isArray(obj.Value) && obj.Value.length > 0) return obj.Value;
  }
  const arrays = collectArrays(raw);
  const objectRows = arrays.filter((rows) => rows.some((item) => item && typeof item === "object"));
  if (objectRows.length > 0) {
    return objectRows.sort((a, b) => b.length - a.length)[0];
  }
  return arrays.sort((a, b) => b.length - a.length)[0] ?? [];
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text && text !== "[object Object]") return text;
  }
  return null;
}

function flattenLookupSource(raw: unknown): unknown[] {
  const rows = unwrapList(raw);
  const nestedKeys = ["Masters", "MasterDetails", "MasterList", "Children", "Items", "Options", "DropDownList"];
  const flattened: unknown[] = [];
  for (const item of rows) {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      let nested: unknown[] | undefined;
      for (const key of nestedKeys) {
        const candidate = obj[key];
        if (Array.isArray(candidate) && candidate.some((row) => row && typeof row === "object")) {
          nested = candidate;
          break;
        }
      }
      if (
        !nested &&
        Array.isArray(obj.Data) &&
        (obj.Code || obj.MasterCode || obj.Heading || obj.startWith) &&
        (obj.Data as unknown[]).some((row) => row && typeof row === "object")
      ) {
        nested = obj.Data as unknown[];
      }
      if (nested && nested.length > 0) {
        flattened.push(...flattenLookupSource(nested));
        continue;
      }
    }
    flattened.push(item);
  }
  return flattened.length > 0 ? flattened : rows;
}

export function asLookupOptions(raw: unknown): LookupOption[] {
  return flattenLookupSource(raw)
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") {
        return { id: String(item), label: String(item) };
      }
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = firstString(row, [
        "Id",
        "id",
        "TemplateId",
        "MasterId",
        "Code",
        "MasterCode",
        "LocationId",
        "ItemId",
        "CurrencyId",
        "UserId",
        "MemberId",
        "OwnerId",
        "WorkFlowId",
        "WorkflowId",
        "StatusId",
        "TaxId",
        "CompanyId",
        "ContactId",
        "value",
        "Value",
        "Title",
        "Text",
        "Name",
      ]);
      const label = firstString(row, [
        "Text",
        "text",
        "Name",
        "Title",
        "Label",
        "DisplayText",
        "DisplayName",
        "MasterName",
        "CompanyName",
        "ContactName",
        "ItemName",
        "ItemCode",
        "TaxName",
        "PricingTitle",
        "QuoteTitle",
        "FullName",
        "UserName",
        "MemberName",
        "OwnerName",
        "StatusName",
        "Status",
        "WorkFlowStatus",
        "LocationName",
        "WorkFlowName",
        "WorkFlow",
        "WorkflowName",
        "Workflow",
        "CurrencyName",
        "NativeSymbol",
        "FirstName",
        "Description",
        "Code",
        "CurrencyCode",
        "Symbol",
        "ShortName",
        "Key",
        "Value",
      ]);
      if (!id) return null;
      return { id, label: label || id, extra: row };
    })
    .filter((option): option is LookupOption => option != null);
}
async function getList(host: "MASTER" | "COMPANY" | "DYNAMIC" | "USER" | "MICRO", path: string): Promise<LookupOption[]> {
  const envelope = await tebRequest(host, path, { method: "GET" });
  const fromValue = asLookupOptions(envelope.value ?? envelope.Data ?? envelope);
  if (fromValue.length > 0) return fromValue;
  return asLookupOptions(envelope);
}

async function getListWithFallback(
  host: "MASTER" | "COMPANY" | "DYNAMIC" | "USER" | "MICRO",
  paths: string[],
): Promise<LookupOption[]> {
  for (const path of paths) {
    try {
      const rows = await getList(host, path);
      if (rows.length > 0) return rows;
    } catch {
      // Try the next live URL shape.
    }
  }
  return [];
}

function looksLikeTypeGroup(option: LookupOption): boolean {
  const blob = `${option.id} ${option.label}`.toLowerCase();
  return blob === "opptype" || blob.includes("opportunity type") || blob === "masterbycode";
}

function filterMasterTypes(rows: LookupOption[]): LookupOption[] {
  if (rows.length === 0) return rows;
  const withoutGroups = rows.filter((row) => !looksLikeTypeGroup(row));
  if (rows.length <= 25) return withoutGroups.length > 0 ? withoutGroups : rows;
  const matched = withoutGroups.filter((row) => {
    const extra = row.extra ?? {};
    const blob = [row.id, row.label, extra.Code, extra.MasterCode, extra.ParentCode, extra.startWith, extra.Heading]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes("opptype") || blob.includes("quotetype") || blob.includes("opp type");
  });
  return matched.length > 0 ? matched : withoutGroups.length > 0 ? withoutGroups : rows;
}

async function getListFirst(
  attempts: Array<{ host: "MASTER" | "COMPANY" | "DYNAMIC" | "USER" | "MICRO"; path: string }>,
): Promise<LookupOption[]> {
  for (const attempt of attempts) {
    try {
      const rows = await getList(attempt.host, attempt.path);
      if (rows.length > 0) return rows;
    } catch {
      // Try the next live URL shape.
    }
  }
  return [];
}

export async function listQuoteTypes(): Promise<LookupOption[]> {
  const rows = await getListFirst([
    { host: "MASTER", path: "FnGetDropdown(dropdownCode='MASTERBYCODE',startWith='OPPTYPE')" },
    { host: "MASTER", path: "FnGetDropdown?dropdownCode=MASTERBYCODE&startWith=OPPTYPE" },
    { host: "MICRO", path: "gateway/dropdown/getconstantdata?type=OPPTYPE" },
    { host: "MICRO", path: "gateway/common/GetMasterFormDetail?masterCode=OPPTYPE" },
    { host: "COMPANY", path: "FnGetDropdown(dropdownCode='MASTERBYCODE',startWith='OPPTYPE')" },
  ]);
  return filterMasterTypes(rows);
}

export async function listCurrencies(): Promise<LookupOption[]> {
  const rows = await getListFirst([
    { host: "MASTER", path: "FnGetCurrencyConverionDropdown" },
    { host: "MASTER", path: "FnGetCurrencyConverionDropdown()" },
    { host: "MASTER", path: "FnGetDropdown(dropdownCode='CURRENCY',startWith='')" },
    { host: "USER", path: "FnGetCurrencyList()" },
    { host: "COMPANY", path: "FnGetCurrencyList()" },
    { host: "MICRO", path: "gateway/dropdown/getconstantdata?type=CURRENCY" },
  ]);
  cacheCurrencyList(rows);
  return rows;
}

export async function listLocations(): Promise<LookupOption[]> {
  const company = await getListWithFallback("COMPANY", ["FnGetLocationDropdown", "FnGetLocationDropdown()"]);
  if (company.length > 0) return company;
  return getListWithFallback("MICRO", [
    "gateway/DropDown/GetLocationDropDown",
    "gateway/dropdown/GetLocationDropDown",
  ]);
}

export function ownerFromUser(user?: TebUserDetail | null): LookupOption | null {
  if (!user) return null;
  const row = user as Record<string, unknown>;
  const id = firstString(row, ["UserId", "Id", "id", "UserID"]);
  if (!id) return null;
  const combined = [user.FirstName, user.LastName].filter(Boolean).join(" ").trim();
  const label = combined || firstString(row, ["Name", "UserName", "Email", "FullName"]) || id;
  return { id, label, extra: row };
}

function looksLikeUserId(value: string): boolean {
  const text = value.trim();
  if (!text || /\s/.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  return /^[0-9a-f]{24}$/i.test(text);
}

function personNeedles(option: LookupOption): string[] {
  const extra = option.extra ?? {};
  return [
    option.label,
    option.id,
    String(extra.Text ?? ""),
    String(extra.UserName ?? ""),
    String(extra.FullName ?? ""),
    String(extra.Name ?? ""),
    String(extra.Email ?? ""),
    String(extra.SubText ?? ""),
    [extra.FirstName, extra.LastName].filter(Boolean).join(" "),
  ]
    .map((value) => value.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function matchPeople(options: LookupOption[], needle: string): LookupOption[] {
  const want = needle.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!want) return [];
  const exact = options.filter((option) => personNeedles(option).includes(want) || option.id === needle);
  if (exact.length > 0) return exact;
  const starts = options.filter((option) => personNeedles(option).some((value) => value.startsWith(want)));
  if (starts.length === 1) return starts;
  return options.filter((option) => personNeedles(option).some((value) => value.includes(want)));
}

export function pickPerson(matches: LookupOption[], needle: string): LookupOption | null {
  if (matches.length === 0) return null;
  const want = needle.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
  const exact = matches.find((option) => personNeedles(option).includes(want) || option.id === needle);
  if (exact) return exact;
  const starts = matches.filter((option) => personNeedles(option).some((value) => value.startsWith(want)));
  if (starts.length === 1) return starts[0];
  if (matches.length === 1) return matches[0];
  return null;
}

function mergeOwnerOptions(groups: LookupOption[][]): LookupOption[] {
  const seen = new Map<string, LookupOption>();
  const better = (next: LookupOption, current: LookupOption) => {
    const nextBad = !next.label || looksLikeUserId(next.label);
    const currentBad = !current.label || looksLikeUserId(current.label);
    if (currentBad && !nextBad) return true;
    if (!currentBad && !nextBad && next.label.includes(" ") && !current.label.includes(" ")) return true;
    return false;
  };
  for (const group of groups) {
    for (const option of group) {
      if (!option.id) continue;
      const current = seen.get(option.id);
      if (!current) {
        seen.set(option.id, option);
        continue;
      }
      if (better(option, current)) {
        seen.set(option.id, { ...current, ...option, extra: { ...current.extra, ...option.extra } });
      }
    }
  }
  return [...seen.values()];
}

export async function listOwners(): Promise<LookupOption[]> {
  const groups: LookupOption[][] = [asLookupOptions(getSubscriberUsers())];
  const dropdown = await getListWithFallback("USER", ["FnGetSubscriberUsersDropdown()", "FnGetSubscriberUsersDropdown"]);
  if (dropdown.length > 0) groups.push(dropdown);
  try {
    const envelope = await tebRequest("MICRO", "gateway/admin/GetSubscriberActiveUsers?Module=TEBLead&NoData=No%20Owner");
    const active = asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
    if (active.length > 0) groups.push(active);
  } catch {
    // Quote / generic owner dropdown still covers most logins.
  }
  const company = await getListWithFallback("COMPANY", [
    "FnGetCurrentUserTeamMembers()?moduleName=TEBQuote",
    "FnGetCurrentUserTeamMembers?moduleName=TEBQuote",
    "FnGetCurrentUserTeamMembers()?moduleName=SalesManagement",
    "FnGetCurrentUserTeamMembers?moduleName=SalesManagement",
  ]);
  if (company.length > 0) groups.push(company);
  const fallback = await getListWithFallback("MICRO", ["gateway/admin/GetUserDropdown"]);
  if (fallback.length > 0) groups.push(fallback);
  return mergeOwnerOptions(groups);
}

export async function getSubscriberUserCurrency(): Promise<LookupOption | null> {
  for (const path of ["FnGetSubscriberUserCurrency", "FnGetSubscriberUserCurrency()"]) {
    try {
      const envelope = await tebRequest<Record<string, unknown>>("USER", path);
      const found = currencyFromUnknown(envelope) ?? currencyFromUnknown(envelope.Data);
      if (found) return found;
    } catch {
      // Try the parenthesized OData form next.
    }
  }
  return null;
}

function currencyFromUnknown(raw: unknown): LookupOption | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = currencyFromUnknown(item);
      if (found) return found;
    }
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = firstString(row, [
    "UserCurrencyId",
    "UserLocationCurrencyId",
    "SubscriberCurrencyId",
    "CurrencyId",
  ]);
  if (id) {
    const label =
      firstString(row, ["UserCurrency", "CurrencyName", "CurrencyCode", "Code", "Symbol", "NativeSymbol", "Name"]) ??
      id;
    return { id, label, extra: row };
  }
  for (const nested of Object.values(row)) {
    if (nested && typeof nested === "object") {
      const found = currencyFromUnknown(nested);
      if (found) return found;
    }
  }
  return null;
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function unwrapDynamic(raw: unknown): unknown {
  let current = parseMaybeJson(raw);
  for (let i = 0; i < 5; i += 1) {
    if (typeof current === "string") {
      const next = parseMaybeJson(current);
      if (next === current) break;
      current = next;
      continue;
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const obj = current as Record<string, unknown>;
      const nested = obj.value ?? obj.Value;
      if (nested != null && nested !== current && (typeof nested === "string" || typeof nested === "object")) {
        current = parseMaybeJson(nested);
        continue;
      }
    }
    break;
  }
  return current;
}

function envelopeValue(envelope: { Value?: unknown; value?: unknown; Data?: unknown }): unknown {
  return unwrapDynamic(envelope.Value ?? envelope.value ?? envelope.Data);
}

function asText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function expandItemRow(row: Record<string, unknown>): Record<string, unknown> {
  const extra = parseMaybeJson(row.Extra ?? row.extra);
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    return { ...(extra as Record<string, unknown>), ...row };
  }
  return row;
}

function itemRecords(raw: unknown): Record<string, unknown>[] {
  const parsed = unwrapDynamic(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      .map(expandItemRow);
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.ItemDetail)) return itemRecords(obj.ItemDetail);
    const looksLikeItem =
      obj.ItemName != null || obj.PricePerUnit != null || obj.UnitPrice != null || obj.ItemId != null;
    if (looksLikeItem) return [expandItemRow(obj)];
    for (const key of ["Items", "ItemList", "Data", "value", "Value", "d"]) {
      if (key in obj) {
        const inner = itemRecords(obj[key]);
        if (inner.length > 0) return inner;
      }
    }
    if (obj.Id != null) return [expandItemRow(obj)];
  }
  return [];
}

/** Live company/contact typeahead: MICRO `gateway/contact/getcustomerdetails`. */
async function searchCustomers(
  businessType: "COMPANY" | "CONTACT",
  keyword: string,
  options: PartySearchOptions = {},
): Promise<LookupOption[]> {
  const body: Record<string, unknown> = {
    BusinessType: businessType,
    SearchKeyWord: keyword,
    IsAll: options.isAll ?? true,
  };
  if (options.parentId) {
    body.CompanyId = options.parentId;
    body.EntityId = options.parentId;
  }
  try {
    const envelope = await tebRequest("MICRO", "gateway/contact/getcustomerdetails", {
      method: "POST",
      body,
    });
    const rows = asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
    if (rows.length > 0) return rows;
  } catch {
    // Fall back to wrapped Dynamic DROPDOWN.
  }
  const fallback = await acGetData({
    Module: "BusinessContactManagement",
    Code: businessType,
    PrimaryKey: options.parentId ?? "",
    Data: JSON.stringify(keyword),
    Action: "DROPDOWN",
  });
  return asLookupOptions(fallback.Value ?? fallback.value ?? fallback.Data);
}

export function searchCompanies(keyword: string, options: PartySearchOptions = {}): Promise<LookupOption[]> {
  return searchCustomers("COMPANY", keyword, options);
}

export function searchContacts(keyword: string, options: PartySearchOptions = {}): Promise<LookupOption[]> {
  return searchCustomers("CONTACT", keyword, options);
}

function lookupOptionsFromItemRows(rows: Record<string, unknown>[]): LookupOption[] {
  const options: LookupOption[] = [];
  for (const row of rows) {
    const id = asText(row.Id ?? row.ItemId);
    if (!id) continue;
    options.push({
      id,
      label: asText(row.ItemName ?? row.Name ?? row.Text ?? row.ItemCode ?? id),
      extra: row,
    });
  }
  return options;
}

export async function searchItems(keyword: string): Promise<LookupOption[]> {
  const envelope = await acGetData({
    Module: "ProductsManagement",
    Code: "ITEM",
    PrimaryKey: "",
    Data: JSON.stringify({ Search: keyword, ParentId: "", CategoryId: "", BrandId: "" }),
    Action: "DROPDOWN",
  });
  const options = lookupOptionsFromItemRows(itemRecords(envelopeValue(envelope)));
  if (options.length > 0) return options;
  const fallback = await acGetData({
    Module: "ProductsManagement",
    Code: "ITEM",
    PrimaryKey: "",
    Data: JSON.stringify(keyword),
    Action: "DROPDOWN",
  });
  return lookupOptionsFromItemRows(itemRecords(envelopeValue(fallback)));
}
