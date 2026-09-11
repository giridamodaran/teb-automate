import { getSetting, getSubscriberUsers } from "@/lib/auth/session";
import { tebRequest } from "@/lib/api/client";
import { TebApiError, type TebUserDetail } from "@/lib/api/types";
import { cacheCurrencyList } from "@/lib/money";
import {
  acAddDetail,
  acGetData,
  getQuoteDefaults,
  getQuoteModuleSetting,
  parseQuoteModuleFlags,
  QUOTE_ACTION,
  QUOTE_MODULE,
  type QuoteModuleFlags,
} from "@/lib/api/quote";

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

export function lookupFromValue(raw: unknown, fallbackLabel = ""): LookupOption | null {
  if (raw == null || raw === "" || raw === "null") return null;
  if (typeof raw === "string" || typeof raw === "number") {
    const id = String(raw);
    if (!id.trim()) return null;
    return { id, label: fallbackLabel || id };
  }
  if (typeof raw === "object") {
    const options = asLookupOptions([raw]);
    if (options[0]) return options[0];
    const row = raw as Record<string, unknown>;
    const nested = row.Value ?? row.value;
    if (nested != null && nested !== raw) return lookupFromValue(nested, fallbackLabel);
  }
  return null;
}

export function pickDefault(
  options: LookupOption[],
  preferredId?: string | null,
  fallback: "first" | "none" = "none",
): LookupOption | null {
  if (preferredId) {
    const match = resolveOption(options, { id: preferredId, label: preferredId });
    if (match) return match;
  }
  const flagged = options.find((option) => isDefaultFlag(option.extra ?? {}));
  if (flagged) return flagged;
  if (options.length === 1) return options[0];
  if (fallback === "first") return options[0] ?? null;
  return null;
}

function isDefaultFlag(extra: Record<string, unknown>): boolean {
  const keys = ["IsDefault", "isdefault", "Default", "IsDefaultLocation", "IsSelected", "Selected"];
  return keys.some((key) => {
    const value = extra[key];
    return (
      value === true ||
      value === 1 ||
      value === "1" ||
      value === "true" ||
      value === "True" ||
      value === "TRUE" ||
      value === "yes" ||
      value === "Yes"
    );
  });
}

export function resolveOption(options: LookupOption[], candidate: LookupOption | null | undefined): LookupOption | null {
  if (!candidate) return null;
  const id = candidate.id.trim().toLowerCase();
  const label = candidate.label.trim().toLowerCase();
  const byId = options.find((option) => option.id.toLowerCase() === id);
  if (byId) return byId;
  const byLabel = options.find((option) => option.label.toLowerCase() === label);
  if (byLabel) return byLabel;
  const byCode = options.find((option) => {
    const extra = option.extra ?? {};
    const code = firstString(extra, ["Code", "CurrencyCode", "ShortName", "Symbol"]);
    return Boolean(code && (code.toLowerCase() === id || code.toLowerCase() === label));
  });
  return byCode ?? null;
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

export async function listWorkflows(locationId = ""): Promise<LookupOption[]> {
  const query = `locationId=${encodeURIComponent(locationId)}&module=TEBQuote`;
  return getListFirst([
    { host: "COMPANY", path: `FnGetWorkFlowDropdown?${query}` },
    { host: "COMPANY", path: `FnGetWorkFlowDropdown()?${query}` },
    { host: "COMPANY", path: "FnGetWorkFlowDropdown?module=TEBQuote" },
    { host: "COMPANY", path: "FnGetWorkFlowDropdown()?module=TEBQuote" },
    { host: "COMPANY", path: "FnGetWorkflowByModule?moduleName=TEBQuote" },
    { host: "COMPANY", path: "FnGetWorkflowByModule()?moduleName=TEBQuote" },
    { host: "COMPANY", path: "FnGetWorkflowByModule?moduleName=EstimationManagement" },
    { host: "COMPANY", path: "FnGetWorkflowByModule?moduleName=SalesManagement" },
    { host: "MICRO", path: "gateway/common/GetAllWorkflowList?module=TEBQuote" },
    { host: "MICRO", path: "gateway/common/GetAllWorkflowList?moduleName=TEBQuote" },
  ]);
}

export async function listQuoteStatuses(workflowId = ""): Promise<LookupOption[]> {
  if (!workflowId) return [];
  const query = `workflowId=${encodeURIComponent(workflowId)}&module=TEBQuote`;
  const rows = await getListFirst([
    { host: "COMPANY", path: `FnGetWorkFlowStatusWithWonLostDropdown?${query}` },
    { host: "COMPANY", path: `FnGetWorkFlowStatusWithWonLostDropdown()?${query}` },
    { host: "MASTER", path: `AcGetWorkFlowStepsByWorkflow?workflowId=${encodeURIComponent(workflowId)}` },
    { host: "MASTER", path: `AcGetWorkFlowStepsByWorkflow()?workflowId=${encodeURIComponent(workflowId)}` },
  ]);
  return rows.map((row) => {
    const extra = row.extra ?? {};
    const id = firstString(extra, ["StatusId", "Code", "WorkFlowStatusId", "Id"]) || row.id;
    return { ...row, id };
  });
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

export async function listOwners(): Promise<LookupOption[]> {
  const fromSession = asLookupOptions(getSubscriberUsers());
  if (fromSession.length > 0) return fromSession;
  const company = await getListWithFallback("COMPANY", [
    "FnGetCurrentUserTeamMembers()?moduleName=TEBQuote",
    "FnGetCurrentUserTeamMembers?moduleName=TEBQuote",
    "FnGetCurrentUserTeamMembers()?moduleName=SalesManagement",
    "FnGetCurrentUserTeamMembers?moduleName=SalesManagement",
  ]);
  if (company.length > 0) return company;
  return getListWithFallback("MICRO", ["gateway/admin/GetUserDropdown"]);
}

export async function loadQuoteModuleFlags(): Promise<QuoteModuleFlags> {
  try {
    const raw = await getQuoteModuleSetting();
    return parseQuoteModuleFlags(raw);
  } catch {
    return { showAllCompanies: false, editContact: false };
  }
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

export interface QuoteAddDefaults {
  flags: QuoteModuleFlags;
  types: LookupOption[];
  locations: LookupOption[];
  currencies: LookupOption[];
  owners: LookupOption[];
  workflows: LookupOption[];
  quoteType: LookupOption | null;
  location: LookupOption | null;
  workflow: LookupOption | null;
  currency: LookupOption | null;
  owner: LookupOption | null;
  company: LookupOption | null;
  contact: LookupOption | null;
  raw: Record<string, unknown>;
}

export async function loadQuoteAddDefaults(currentUser?: LookupOption | null): Promise<QuoteAddDefaults> {
  const [flags, types, locations, currencies, owners, raw, userCurrency, workflowsUnscoped] = await Promise.all([
    loadQuoteModuleFlags(),
    listQuoteTypes().catch(() => [] as LookupOption[]),
    listLocations().catch(() => [] as LookupOption[]),
    listCurrencies().catch(() => [] as LookupOption[]),
    listOwners().catch(() => [] as LookupOption[]),
    getQuoteDefaults().catch(() => ({}) as Record<string, unknown>),
    getSubscriberUserCurrency().catch(() => null),
    listWorkflows("").catch(() => [] as LookupOption[]),
  ]);

  const fromSetting = defaultsFromSetting();
  const currencyList =
    fromSetting.currency && !currencies.some((row) => row.id === fromSetting.currency?.id)
      ? [fromSetting.currency, ...currencies]
      : currencies;
  const preferredLocation =
    lookupFromValue(raw.LocationId) ??
    lookupFromValue(raw.SiteId) ??
    fromSetting.location;
  const location = pickDefault(locations, preferredLocation?.id, "first") ?? preferredLocation ?? null;

  let workflows = workflowsUnscoped;
  if (location?.id) {
    const scoped = await listWorkflows(location.id).catch(() => [] as LookupOption[]);
    if (scoped.length > 0) workflows = scoped;
  }
  const preferredWorkflow = lookupFromValue(raw.WorkFlowId) ?? lookupFromValue(raw.WorkflowId);
  const preferredCurrency =
    lookupFromValue(raw.CurrencyId) ?? userCurrency ?? fromSetting.currency;
  const company = lookupFromValue(raw.CompanyId);
  const contact = lookupFromValue(raw.ContactId);

  const owner =
    resolveOption(owners, currentUser) ??
    currentUser ??
    pickDefault(owners, lookupFromValue(raw.OwnerId)?.id, "first") ??
    lookupFromValue(raw.OwnerId) ??
    lookupFromValue(raw.Owner);

  const ownerList = owner && !owners.some((row) => row.id === owner.id) ? [owner, ...owners] : owners;

  return {
    flags,
    types,
    locations,
    currencies: currencyList,
    owners: ownerList,
    workflows,
    quoteType: pickDefault(types, lookupFromValue(raw.QuoteTypeId)?.id, "first") ?? types[0] ?? null,
    location,
    workflow: pickDefault(workflows, preferredWorkflow?.id, "first") ?? preferredWorkflow ?? workflows[0] ?? null,
    currency:
      pickDefault(currencyList, preferredCurrency?.id, "first") ??
      resolveOption(currencyList, preferredCurrency) ??
      preferredCurrency ??
      currencyList[0] ??
      null,
    owner,
    company,
    contact,
    raw,
  };
}

function settingRecord(): Record<string, unknown> | undefined {
  const stored = getSetting() as Record<string, unknown> | Record<string, unknown>[] | null;
  if (!stored) return undefined;
  const candidates: unknown[] = [stored];
  const seen = new Set<unknown>();
  while (candidates.length > 0) {
    const current = candidates.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current[0]) candidates.unshift(current[0]);
      continue;
    }
    const row = current as Record<string, unknown>;
    if (row.CurrencyId != null || row.Currency != null || row.DefaultCurrencyId != null) {
      return row;
    }
    for (const key of ["Data", "value", "Value", "d"]) {
      if (key in row) candidates.push(row[key]);
    }
  }
  const root = (Array.isArray(stored) ? stored[0] : stored) as Record<string, unknown> | undefined;
  if (!root) return undefined;
  if (Array.isArray(root.value)) return root.value[0] as Record<string, unknown>;
  if (Array.isArray(root.Data)) return (root.Data[0] as Record<string, unknown>) ?? undefined;
  if (root.Data && typeof root.Data === "object" && !Array.isArray(root.Data)) {
    return root.Data as Record<string, unknown>;
  }
  return root;
}

export function currencyFromSession(): LookupOption | null {
  return defaultsFromSetting().currency;
}

function defaultsFromSetting(): { location: LookupOption | null; currency: LookupOption | null } {
  const setting = settingRecord();
  if (!setting) return { location: null, currency: null };
  const nestedCurrency = Array.isArray(setting.Currency) ? setting.Currency[0] : setting.Currency;
  return {
    location:
      lookupFromValue(setting.LocationId) ??
      lookupFromValue(setting.DefaultLocationId) ??
      lookupFromValue(setting.Location) ??
      lookupFromValue(setting.SiteId),
    currency:
      lookupFromValue(setting.CurrencyId) ??
      lookupFromValue(setting.DefaultCurrencyId) ??
      lookupFromValue(setting.UserCurrencyId) ??
      lookupFromValue(setting.SubscriberCurrencyId) ??
      (nestedCurrency && typeof nestedCurrency === "object"
        ? lookupFromValue(nestedCurrency)
        : lookupFromValue(nestedCurrency)),
  };
}

export function quoteTitleFromParty(company: LookupOption | null, contact: LookupOption | null, quoteFor?: string): string {
  const setting = (quoteFor ?? "").toLowerCase();
  if (setting.includes("b2c") || setting.includes("consumer")) {
    return (contact?.label || company?.label || "").trim();
  }
  return (company?.label || contact?.label || "").trim();
}

function nestedLookup(extra: Record<string, unknown>, objectKey: string, idKeys: string[], labelKeys: string[]): LookupOption | null {
  const nested = extra[objectKey];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const fromObject = lookupFromValue(nested);
    if (fromObject) return fromObject;
  }
  const id = firstString(extra, idKeys);
  if (!id) return null;
  const label = firstString(extra, labelKeys) ?? id;
  return { id, label, extra };
}

export function billingLocationFromParty(option: LookupOption | null): LookupOption | null {
  if (!option?.extra) return null;
  return (
    nestedLookup(option.extra, "BillingLocation", ["BillingLocationId", "DefaultBillingLocationId"], [
      "BillingLocationName",
      "BillingLocation",
      "DefaultBillingLocation",
    ]) ??
    nestedLookup(option.extra, "DefaultBillingLocation", ["DefaultBillingLocationId"], ["DefaultBillingLocationName"]) ??
    siteFromParty(option)
  );
}

export function siteFromParty(option: LookupOption | null): LookupOption | null {
  if (!option?.extra) return null;
  return nestedLookup(option.extra, "Location", ["LocationId", "SiteId", "DefaultLocationId"], [
    "LocationName",
    "SiteName",
    "Location",
    "Site",
  ]);
}

export function workflowFromParty(option: LookupOption | null): LookupOption | null {
  if (!option?.extra) return null;
  return nestedLookup(option.extra, "WorkFlow", ["WorkFlowId", "WorkflowId"], ["WorkFlow", "Workflow", "WorkFlowName"]);
}

export function ownerFromParty(option: LookupOption | null): LookupOption | null {
  if (!option?.extra) return null;
  return nestedLookup(option.extra, "Owner", ["OwnerId"], ["OwnerName", "Owner"]);
}

export function currencyFromParty(option: LookupOption | null): LookupOption | null {
  if (!option?.extra) return null;
  return nestedLookup(option.extra, "Currency", ["CurrencyId", "Currency"], ["CurrencyName", "Currency", "CurrencyCode"]);
}

export type DiscountValueType = "PERCENTAGE" | "VALUE";
export type DiscountKind = string;

export function isCatalogDiscount(kind: string | undefined): boolean {
  return Boolean(kind) && kind !== "INLINEDISCOUNT";
}

export function discountTypeLabel(kind: string | undefined, types: LookupOption[] = []): string {
  if (!kind || kind === "INLINEDISCOUNT") return "Inline";
  const match = types.find((row) => row.id === kind);
  if (match?.label) return match.label;
  if (kind === "VOUCHERDISCOUNT") return "Voucher";
  if (kind === "RANGEDISCOUNT") return "Range";
  return kind.replace(/DISCOUNT$/i, "").replace(/([A-Z])/g, " $1").trim() || "Discount";
}

export function canonicalDiscountTypeId(id: string, label = ""): string {
  const blob = `${id} ${label}`.toUpperCase().replace(/[\s_-]+/g, "");
  if (blob.includes("INLINE")) return "INLINEDISCOUNT";
  if (blob.includes("VOUCHER")) return "VOUCHERDISCOUNT";
  if (blob.includes("RANGE")) return "RANGEDISCOUNT";
  return id.trim();
}

export interface QuoteLinePayload {
  SequenceNo?: number;
  Id?: string;
  ItemId?: string;
  ItemName?: string;
  PricePerUnit?: number;
  UnitPrice?: number;
  PriceSchemeId?: string;
  Quantity?: number;
  UnitId?: string;
  Unit?: string;
  OverrideQuantity?: string;
  Discount?: number;
  DiscountValueType?: DiscountValueType;
  DiscountType?: DiscountKind;
  DiscountId?: string;
  Tax?: number;
  TaxId?: string;
  TaxIds?: string[];
  PriceType?: string;
  extra?: Record<string, unknown>;
}

export interface ItemDefaults {
  itemId: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  multiples: number;
  overrideQuantity: boolean;
  discountAmount: number;
  maxInlineDiscount: number;
  priceType: string;
  schemes: LookupOption[];
  priceMethods: LookupOption[];
  units: LookupOption[];
  unit: LookupOption | null;
  tax: LookupOption | null;
  taxes: LookupOption[];
  extra: Record<string, unknown>;
}

export interface QuoteItemView {
  ItemDetail: Record<string, unknown>[];
  Group: unknown[];
  TotalSummary: unknown;
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

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return asNumber(obj.Value ?? obj.value ?? obj.Amount ?? obj.Price ?? obj.PricePerUnit, fallback);
  }
  return fallback;
}

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const parsed = asNumber(value, NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function priceFromRecord(row: Record<string, unknown>, depth = 0): number {
  const direct = firstPositive(
    row.PricePerUnit,
    row.UnitPrice,
    row.SellingPrice,
    row.SalePrice,
    row.DefaultSellingPrice,
    row.DefaultPrice,
    row.ListPrice,
    row.MRP,
    row.ItemPrice,
    row.PriceValue,
    row.Price,
    row.Rate,
    row.SellingRate,
    row.NetAmount,
    row.Amount,
  );
  if (direct > 0) return direct;
  if (depth > 2) return 0;
  const extra = parseMaybeJson(row.Extra ?? row.extra);
  if (extra && typeof extra === "object" && !Array.isArray(extra) && extra !== row) {
    const found = priceFromRecord(extra as Record<string, unknown>, depth + 1);
    if (found > 0) return found;
  }
  for (const [key, value] of Object.entries(row)) {
    if (!/price|rate|ppu/i.test(key) || /discount|tax|cost|min|max|total|charge/i.test(key)) continue;
    const nested = firstPositive(value);
    if (nested > 0) return nested;
    if (value && typeof value === "object") {
      const child = Array.isArray(value) ? value[0] : value;
      if (child && typeof child === "object") {
        const found = priceFromRecord(child as Record<string, unknown>, depth + 1);
        if (found > 0) return found;
      }
    }
  }
  return 0;
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

function rowsForSelectedItem(raw: unknown, itemId: string): Record<string, unknown>[] {
  const unwrapped = unwrapDynamic(raw);
  const isSavedList = Boolean(
    unwrapped &&
      typeof unwrapped === "object" &&
      !Array.isArray(unwrapped) &&
      Array.isArray((unwrapped as Record<string, unknown>).ItemDetail),
  );
  const rows = itemRecords(unwrapped);
  if (isSavedList) {
    return rows.filter((row) => asText(row.ItemId) === itemId && priceFromRecord(row) > 0);
  }
  const matching = rows.filter((row) => asText(row.ItemId) === itemId || asText(row.Id) === itemId);
  const pool = matching.length > 0 ? matching : rows;
  const priced = pool.filter((row) => priceFromRecord(row) > 0);
  return priced.length > 0 ? priced : pool;
}

function asText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

/** Unit price is freely typed only for MANUAL / user pricing. */
export function priceIsEditable(priceType: string): boolean {
  const type = (priceType || "").toUpperCase().replace(/[\s_-]+/g, "");
  return type === "" || type === "MANUAL" || type === "USER" || type === "USERPRICE" || type === "CUSTOM";
}

export function clampQuantity(
  qty: number,
  min: number,
  max: number,
  multiples: number,
): { value: number; hint: string } {
  let next = Number.isFinite(qty) ? qty : 0;
  const minQ = min > 0 ? min : 0;
  const maxQ = max > 0 ? max : 0;
  const step = multiples > 0 && multiples !== 1 ? multiples : 0;
  let hint = "";

  if (next <= 0) {
    next = minQ > 0 ? minQ : 1;
    hint = minQ > 0 ? `Quantity set to minimum (${minQ}).` : "Quantity set to 1.";
  }
  if (minQ > 0 && next < minQ) {
    next = minQ;
    hint = `Quantity raised to minimum (${minQ}).`;
  }
  if (maxQ > 0 && next > maxQ) {
    next = maxQ;
    hint = `Quantity lowered to maximum (${maxQ}).`;
  }
  if (step > 0) {
    let aligned = Math.round(next / step) * step;
    if (minQ > 0 && aligned < minQ) aligned = Math.ceil(minQ / step) * step;
    if (maxQ > 0 && aligned > maxQ) aligned = Math.floor(maxQ / step) * step;
    if (aligned <= 0) aligned = step;
    if (aligned !== next) {
      next = aligned;
      hint = `Quantity adjusted to a multiple of ${step}.`;
    }
  }
  return { value: next, hint };
}

export function clampDiscount(
  input: number,
  mode: DiscountValueType,
  unitPrice: number,
  qty: number,
  maxInlinePercent: number,
): { value: number; hint: string } {
  const raw = Number.isFinite(input) ? input : 0;
  if (raw < 0) return { value: 0, hint: "Discount cannot be less than 0." };
  if (raw === 0) return { value: 0, hint: "" };
  if (unitPrice <= 0) {
    return { value: 0, hint: "You cannot apply a discount when the unit price is 0." };
  }
  const cap = maxInlinePercent > 0 && maxInlinePercent < 100 ? maxInlinePercent : 100;
  if (mode === "PERCENTAGE") {
    if (raw > cap) {
      return {
        value: cap,
        hint: cap < 100 ? `Max inline discount is ${cap}%.` : "Discount cannot be more than 100%.",
      };
    }
    return { value: raw, hint: "" };
  }
  const lineSubtotal = unitPrice * (qty > 0 ? qty : 1);
  const maxValue = Math.round(((lineSubtotal * cap) / 100) * 100) / 100;
  if (raw > maxValue) {
    return {
      value: maxValue,
      hint:
        cap < 100
          ? `Max inline discount is ${cap}% (${maxValue}).`
          : "Discount cannot be more than the line amount.",
    };
  }
  return { value: raw, hint: "" };
}

export function discountAmount(unitPrice: number, qty: number, value: number, mode: DiscountValueType): number {
  if (unitPrice <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  if (mode === "PERCENTAGE") return (unitPrice * qty * value) / 100;
  return value;
}

export function taxAmount(unitPrice: number, qty: number, tax: LookupOption | null): number {
  if (!tax || unitPrice <= 0) return 0;
  const extra = tax.extra ?? {};
  const rate = asNumber(
    extra.TaxValue ?? extra.Rate ?? extra.Value ?? extra.Tax ?? extra.Percentage ?? extra.TaxPercent ?? extra.TaxPercentage,
  );
  if (!Number.isFinite(rate) || rate === 0) return 0;
  const rateType = asText(
    extra.RateType ?? extra.TaxType ?? extra.ValueType ?? extra.TaxValueType ?? extra.SubText ?? "PERCENTAGE",
  ).toUpperCase();
  if (rateType === "VALUE" || rateType === "AMOUNT") return rate * qty;
  return ((unitPrice * rate) / 100) * qty;
}

export function taxOptionLabel(option: LookupOption): string {
  const extra = option.extra ?? {};
  const rate = asNumber(
    extra.TaxValue ?? extra.Rate ?? extra.Value ?? extra.Tax ?? extra.Percentage ?? extra.TaxPercent ?? extra.TaxPercentage,
  );
  if (!Number.isFinite(rate) || rate === 0) return option.label;
  const rateType = asText(
    extra.RateType ?? extra.TaxType ?? extra.ValueType ?? extra.TaxValueType ?? extra.SubText ?? "PERCENTAGE",
  ).toUpperCase();
  const suffix = rateType === "VALUE" || rateType === "AMOUNT" ? ` ${rate}` : ` ${rate}%`;
  return option.label.includes(String(rate)) ? option.label : `${option.label}${suffix}`;
}

export function priceTypeLabel(priceType: string): string {
  const type = (priceType || "").toUpperCase().replace(/[\s_-]+/g, "");
  if (!type) return "Price";
  if (type === "MANUAL" || type === "USER" || type === "USERPRICE" || type === "CUSTOM") return "Manual";
  if (type === "STANDARD" || type === "STD") return "Standard";
  if (type === "FIXED") return "Fixed";
  if (type === "LOOKUPPRICE" || type === "LOOKUP") return "Lookup";
  if (type === "VOLUME") return "Volume";
  if (type === "SPECIFICATION" || type === "SPEC") return "Specification";
  return priceType;
}

export function lineNet(qty: number, price: number, discount: number, tax: number): number {
  return Math.max(0, qty * price - discount + tax);
}

function taxOptionFromRecord(row: Record<string, unknown>): LookupOption | null {
  const id = asText(row.TaxId ?? row.Id ?? row.Tax);
  if (!id && row.TaxValue == null && row.Rate == null) return null;
  return {
    id: id || "item-tax",
    label: asText(row.TaxName ?? row.Name ?? row.Title ?? id) || "Tax",
    extra: row,
  };
}

function taxRecords(raw: unknown): Record<string, unknown>[] {
  const parsed = parseMaybeJson(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
}

export function taxesFromItemRow(row: Record<string, unknown>): LookupOption[] {
  const seen = new Set<string>();
  const options: LookupOption[] = [];
  const push = (option: LookupOption | null) => {
    if (!option || seen.has(option.id)) return;
    seen.add(option.id);
    options.push(option);
  };
  for (const key of ["Taxes", "TaxDetail", "Tax"]) {
    for (const rec of taxRecords(row[key])) push(taxOptionFromRecord(rec));
  }
  if (options.length === 0 && asText(row.TaxId)) {
    push({
      id: asText(row.TaxId),
      label: asText(row.TaxName ?? row.Tax ?? row.TaxId),
      extra: {
        TaxId: row.TaxId,
        TaxName: row.TaxName ?? row.Tax,
        TaxValue: row.TaxValue ?? row.TaxRate,
        RateType: row.RateType ?? row.TaxType,
      },
    });
  }
  return options;
}

function taxFromItemRow(row: Record<string, unknown>): LookupOption | null {
  return taxesFromItemRow(row)[0] ?? null;
}

export function priceMethodsFromRecord(row: Record<string, unknown>): LookupOption[] {
  const raw = row.PricingMethodDetail ?? row.PriceTypeDetail ?? row.ItemPriceType ?? row.PriceTypes;
  if (!Array.isArray(raw)) return [];
  const options: LookupOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const method = item as Record<string, unknown>;
    const type = asText(
      method.PriceType ?? method.PricingType ?? method.Code ?? method.Id ?? method.Value ?? method.Key,
    );
    if (!type) continue;
    const label =
      asText(method.Text ?? method.Title ?? method.Name ?? method.PricingTitle) || priceTypeLabel(type);
    const extra: Record<string, unknown> = { ...method, PriceType: type };
    const listed = priceFromRecord(method);
    if (listed > 0) extra.PricePerUnit = listed;
    options.push({ id: type, label, extra });
  }
  return options;
}

export function appliedDiscountFromRecord(row: Record<string, unknown>): {
  kind: DiscountKind;
  valueType: DiscountValueType;
  input: number;
  voucher: LookupOption | null;
} | null {
  const raw = parseMaybeJson(row.AppliedDiscount);
  const first = (Array.isArray(raw) ? raw[0] : raw && typeof raw === "object" ? raw : null) as
    | Record<string, unknown>
    | null
    | undefined;
  if (first && typeof first === "object") {
    const kind = asText(first.DiscountType).toUpperCase() || "INLINEDISCOUNT";
    const valueType: DiscountValueType = /VALUE|AMOUNT/i.test(asText(first.DiscountValueType ?? first.ValueType))
      ? "VALUE"
      : "PERCENTAGE";
    const input =
      valueType === "PERCENTAGE"
        ? asNumber(first.Percentage ?? first.DiscountValue ?? first.Value ?? first.Discount)
        : asNumber(first.Value ?? first.Discount ?? first.DiscountAmount);
    const discountId = asText(first.DiscountId ?? first.Id);
    return {
      kind,
      valueType,
      input: Number.isFinite(input) ? input : 0,
      voucher:
        isCatalogDiscount(kind) && discountId
          ? { id: discountId, label: asText(first.DiscountName ?? first.Name ?? first.Text) || discountId, extra: first }
          : null,
    };
  }
  const valueType: DiscountValueType = /VALUE|AMOUNT/i.test(asText(row.DiscountValueType)) ? "VALUE" : "PERCENTAGE";
  const kind = asText(row.DiscountType).toUpperCase() || "INLINEDISCOUNT";
  const qty = asNumber(row.Quantity, 1) || 1;
  const price = priceFromRecord(row);
  const listed = asNumber(row.Discount ?? row.DiscountAmount);
  if (!Number.isFinite(listed) || listed <= 0) return null;
  let input = listed;
  if (valueType === "PERCENTAGE") {
    const percent = asNumber(row.Percentage ?? row.DiscountPercentage ?? row.DiscountValue);
    if (percent > 0) input = percent;
    else if (listed > 100 && price > 0) input = (listed / (price * qty)) * 100;
  }
  const discountId = asText(row.DiscountId);
  return {
    kind,
    valueType,
    input,
    voucher:
      isCatalogDiscount(kind) && discountId
        ? { id: discountId, label: asText(row.DiscountName ?? discountId), extra: row }
        : null,
  };
}

export function itemDefaultsFromRecord(row: Record<string, unknown>, fallbackId = ""): ItemDefaults {
  const source = expandItemRow(row);
  const schemes = optionList(source.ItemPriceScheme ?? source.PriceScheme, ["Id", "PriceSchemeId"], [
    "PricingTitle",
    "Title",
    "Text",
    "Name",
  ]);
  const units = unitsFromRecord(source);
  const priceMethods = priceMethodsFromRecord(source);
  const schemePrice = schemes[0]?.extra ? priceFromRecord(schemes[0].extra) : 0;
  const methodPrice = priceMethods[0]?.extra ? priceFromRecord(priceMethods[0].extra) : 0;
  return {
    itemId: asText(source.ItemId) || asText(source.Id) || fallbackId,
    itemName: asText(source.ItemName ?? source.Name ?? source.Text ?? source.Title),
    unitPrice: priceFromRecord(source) || schemePrice || methodPrice,
    quantity: asNumber(source.Quantity, 1) || 1,
    minQuantity: asNumber(source.MinQuantity),
    maxQuantity: asNumber(source.MaxQuantity),
    multiples: asNumber(source.Multiples, 1) || 1,
    overrideQuantity:
      source.OverrideQuantity === true || source.OverrideQuantity === "true" || source.OverrideQuantity === 1,
    discountAmount: firstPositive(source.DiscountPercentage, source.Percentage),
    maxInlineDiscount: (() => {
      const max = asNumber(source.InlineDiscount ?? source.MaxInlineDiscount ?? source.MaxDiscount);
      return max > 0 ? max : 100;
    })(),
    priceType: asText(source.PriceType ?? source.PricingType ?? source.PricingMethod ?? source.ItemPriceType),
    schemes,
    priceMethods,
    units,
    unit: pickItemUnit(units, source),
    tax: taxFromItemRow(source),
    taxes: taxesFromItemRow(source),
    extra: source,
  };
}

function looksLikeId(value: string): boolean {
  return /^[a-f0-9]{16,}$/i.test(value) || (value.length >= 24 && !/\s/.test(value));
}

function isEmptyExtraValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function mergeItemExtra(
  ...sources: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (isEmptyExtraValue(value) && !isEmptyExtraValue(next[key])) continue;
      next[key] = value;
    }
  }
  return next;
}

function captionText(value: unknown, depth = 0): string {
  if (value == null || depth > 3) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    if (!text || text === "[object Object]" || looksLikeId(text)) return "";
    return text;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = captionText(item, depth + 1);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return captionText(
      rec.Text ?? rec.Title ?? rec.Name ?? rec.SpecificationTitle ?? rec.ModelName ?? rec.Value ?? rec.SKU ?? rec.ItemCode,
      depth + 1,
    );
  }
  return "";
}

function specificationLabel(source: Record<string, unknown>): string {
  const titled = captionText(source.SpecificationTitle ?? source.Specification);
  if (titled) return titled;
  const selectedId = asText(source.SpecificationId);
  if (!selectedId) return "";
  const list = parseMaybeJson(source.SpecificationList ?? source.Specifications);
  const rows = Array.isArray(list) ? list : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (asText(rec.SpecificationId ?? rec.Id) !== selectedId) continue;
    const name = captionText(rec.SpecificationTitle ?? rec.Title ?? rec.Name ?? rec.Text);
    if (name) return name;
  }
  return "";
}

/** Secondary lines under a selected item name (live ITEMQUOTE ExtraDisplay: SKU, ItemCode). */
export function itemCaptionDetails(source: Record<string, unknown> | undefined | null, title = ""): string[] {
  const extra = source ?? {};
  const details: string[] = [];
  const seen = new Set<string>();
  const titleKey = title.trim().toLowerCase();
  if (titleKey) seen.add(titleKey);

  const push = (value: unknown) => {
    const text = captionText(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    details.push(text);
  };

  push(extra.SKU);
  push(extra.ItemCode ?? extra.Code);
  push(extra.Model ?? extra.ModelName ?? extra.ItemModel);
  push(specificationLabel(extra));
  push(extra.BrandName ?? extra.Brand);
  return details.slice(0, 4);
}

function mappedUnitsFromRecord(source: Record<string, unknown>): LookupOption[] {
  const raw = parseMaybeJson(
    source.UnitDetail ?? source.Units ?? source.ItemUnits ?? source.UnitList ?? source.ItemUnitDetail,
  );
  const nested =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? ((raw as Record<string, unknown>).UnitDetail ??
        (raw as Record<string, unknown>).Units ??
        (raw as Record<string, unknown>).Data ??
        (raw as Record<string, unknown>).value ??
        raw)
      : raw;
  return optionList(nested, ["Value", "Id", "UnitId"], ["Key", "Text", "Name", "Title", "UnitName", "ItemUnit"]);
}

function unitsFromRecord(source: Record<string, unknown>): LookupOption[] {
  const listed = mappedUnitsFromRecord(source);
  if (listed.length > 0) return listed;
  const id = asText(source.UnitId ?? source.ItemUnitId);
  const label = asText(source.ItemUnit ?? source.UnitName);
  const unitField = asText(source.Unit);
  if (!id && !label && !unitField) return [];
  const unitId = id || (looksLikeId(unitField) ? unitField : "");
  const unitLabel = label || (!looksLikeId(unitField) ? unitField : "") || unitId || unitField;
  return [{ id: unitId || unitLabel, label: unitLabel || unitId }];
}

/** Match saved / item UnitId or ItemUnit against mapped units. */
export function pickItemUnit(
  units: LookupOption[],
  source?: Record<string, unknown> | null,
  preferred?: LookupOption | null,
): LookupOption | null {
  const tokens: string[] = [];
  const push = (value: unknown) => {
    const text = asText(value);
    if (text && !tokens.includes(text)) tokens.push(text);
  };
  if (source) {
    push(source.UnitId);
    push(source.ItemUnitId);
    push(source.ItemUnit);
    push(source.UnitName);
    push(source.Unit);
  }
  push(preferred?.id);
  push(preferred?.label);
  for (const token of tokens) {
    const match = units.find(
      (unit) => unit.id === token || unit.label.toLowerCase() === token.toLowerCase(),
    );
    if (match) return match;
  }
  if (preferred?.id || preferred?.label) return preferred;
  if (units[0]) return units[0];
  const id = asText(source?.UnitId ?? source?.ItemUnitId);
  const label = asText(source?.ItemUnit ?? source?.UnitName ?? source?.Unit);
  if (id || label) return { id: id || label, label: label || id };
  return null;
}

function optionList(raw: unknown, idKeys: string[], labelKeys: string[]): LookupOption[] {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return asLookupOptions(parsed);
  const options: LookupOption[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = asText(row.Key);
    const value = asText(row.Value);
    if (key || value) {
      const keyIsId = looksLikeId(key);
      const valueIsId = looksLikeId(value);
      const id = keyIsId && !valueIsId ? key : valueIsId && !keyIsId ? value : asText(idKeys.map((k) => row[k]).find((v) => asText(v))) || key || value;
      const label = keyIsId && !valueIsId ? value || key : valueIsId && !keyIsId ? key || value : asText(labelKeys.map((k) => row[k]).find((v) => asText(v))) || id;
      if (id) options.push({ id, label: label || id, extra: row });
      continue;
    }
    const id = asText(idKeys.map((k) => row[k]).find((v) => asText(v)));
    if (!id) continue;
    const label = asText(labelKeys.map((k) => row[k]).find((v) => asText(v))) || id;
    options.push({ id, label, extra: row });
  }
  return options;
}

async function fetchViewItemDefaults(
  itemId: string,
  quoteId?: string,
): Promise<{ rows: Record<string, unknown>[]; error: TebApiError | null }> {
  const attempts: Array<{ Module: string; PrimaryKey: string; Data: unknown }> = [
    { Module: "SalesManagement", PrimaryKey: "", Data: { Search: "", ItemId: [itemId] } },
  ];
  if (quoteId) {
    attempts.push({
      Module: QUOTE_MODULE.estimation,
      PrimaryKey: quoteId,
      Data: { Search: "", ItemId: [itemId], EntityId: quoteId },
    });
    attempts.push({ Module: "SalesManagement", PrimaryKey: "", Data: { Search: "", ItemId: [itemId], EntityId: quoteId } });
  }
  let fallback: Record<string, unknown>[] = [];
  let error: TebApiError | null = null;
  for (const attempt of attempts) {
    try {
      const envelope = await acGetData({
        Module: attempt.Module,
        Code: QUOTE_ACTION.viewItem,
        PrimaryKey: attempt.PrimaryKey,
        Data: JSON.stringify(attempt.Data),
        Action: QUOTE_ACTION.viewItem,
      });
      const rows = rowsForSelectedItem(envelopeValue(envelope), itemId);
      if (rows.some((row) => priceFromRecord(row) > 0)) return { rows, error: null };
      if (rows.length > fallback.length) fallback = rows;
    } catch (err) {
      if (err instanceof TebApiError && err.status < 500 && err.message && !err.message.startsWith("Request failed")) {
        error = err;
      }
    }
  }
  return { rows: fallback, error };
}

/** Live CHANGEVAL loads PricePerUnit from VIEWITEM `{ Search, ItemId }`, then catalog DROPDOWN for schemes/units. */
export async function getItemDefaults(
  itemId: string,
  hint?: Record<string, unknown> | null,
  quoteId?: string,
): Promise<ItemDefaults | null> {
  const tryDropdown = async (data: unknown) => {
    const envelope = await acGetData({
      Module: "ProductsManagement",
      Code: "ITEM",
      PrimaryKey: "",
      Data: JSON.stringify(data),
      Action: "DROPDOWN",
    });
    return rowsForSelectedItem(envelopeValue(envelope), itemId);
  };

  const viewed = await fetchViewItemDefaults(itemId, quoteId);
  const rows = [...viewed.rows];
  const needsDropdown = () =>
    !rows.some((row) => priceFromRecord(row) > 0) ||
    !rows.some((row) => mappedUnitsFromRecord(expandItemRow(row)).length > 0);
  if (needsDropdown()) {
    try {
      rows.push(...(await tryDropdown({ Search: "", ItemId: [itemId] })));
    } catch {
      // ignore
    }
  }
  if (needsDropdown()) {
    try {
      rows.push(...(await tryDropdown({ Search: itemId, ParentId: "", CategoryId: "", BrandId: "" })));
    } catch {
      // ignore
    }
  }

  const fetched =
    rows.find((row) => priceFromRecord(row) > 0) ??
    rows.find((row) => asText(row.ItemId) === itemId || asText(row.Id) === itemId) ??
    rows[0] ??
    null;
  if (viewed.error && !(fetched && priceFromRecord(fetched) > 0)) {
    throw viewed.error;
  }
  const fromHint = hint ? itemDefaultsFromRecord(hint, itemId) : null;
  const fromFetch = fetched ? itemDefaultsFromRecord(fetched, itemId) : null;
  if (!fromHint && !fromFetch) return null;
  const schemes = fromFetch?.schemes.length ? fromFetch.schemes : fromHint?.schemes ?? [];
  const schemePrice = schemes[0]?.extra ? priceFromRecord(schemes[0].extra) : 0;
  const unitPrice =
    (fromFetch?.unitPrice || 0) > 0
      ? fromFetch!.unitPrice
      : (fromHint?.unitPrice || 0) > 0
        ? fromHint!.unitPrice
        : schemePrice;
  const mappedFetch = fromFetch ? mappedUnitsFromRecord(fromFetch.extra) : [];
  const mappedHint = fromHint ? mappedUnitsFromRecord(fromHint.extra) : [];
  let units = mappedFetch.length
    ? mappedFetch
    : mappedHint.length
      ? mappedHint
      : fromFetch?.units.length
        ? fromFetch.units
        : fromHint?.units ?? [];
  if (mappedFetch.length === 0 && mappedHint.length === 0) {
    for (const row of rows) {
      const parsed = mappedUnitsFromRecord(expandItemRow(row));
      if (parsed.length > 0) {
        units = parsed;
        break;
      }
    }
  }
  const extra = mergeItemExtra(fromHint?.extra, fromFetch?.extra);
  return {
    itemId: fromFetch?.itemId || fromHint?.itemId || itemId,
    itemName: fromFetch?.itemName || fromHint?.itemName || "",
    unitPrice,
    quantity: fromFetch?.quantity || fromHint?.quantity || 1,
    minQuantity: fromFetch?.minQuantity || fromHint?.minQuantity || 0,
    maxQuantity: fromFetch?.maxQuantity || fromHint?.maxQuantity || 0,
    multiples: fromFetch?.multiples || fromHint?.multiples || 1,
    overrideQuantity: Boolean(fromFetch?.overrideQuantity || fromHint?.overrideQuantity),
    discountAmount: (fromFetch?.discountAmount || 0) > 0 ? fromFetch!.discountAmount : fromHint?.discountAmount ?? 0,
    maxInlineDiscount: fromFetch?.maxInlineDiscount || fromHint?.maxInlineDiscount || 100,
    priceType: fromFetch?.priceType || fromHint?.priceType || "",
    schemes,
    priceMethods:
      (fromFetch?.priceMethods.length ? fromFetch.priceMethods : null) ?? fromHint?.priceMethods ?? [],
    units,
    unit: pickItemUnit(units, extra, fromFetch?.unit ?? fromHint?.unit ?? null),
    tax: fromFetch?.tax ?? fromHint?.tax ?? null,
    taxes:
      (fromFetch?.taxes && fromFetch.taxes.length > 0 ? fromFetch.taxes : null) ??
      (fromHint?.taxes && fromHint.taxes.length > 0 ? fromHint.taxes : null) ??
      (fromFetch?.tax ? [fromFetch.tax] : fromHint?.tax ? [fromHint.tax] : []),
    extra,
  };
}

export async function listQuoteTaxes(quoteId: string): Promise<LookupOption[]> {
  const attempts: Array<{ Module: string; PrimaryKey: string; Data: string }> = [
    { Module: QUOTE_MODULE.estimation, PrimaryKey: quoteId, Data: "" },
    { Module: QUOTE_MODULE.estimation, PrimaryKey: "", Data: JSON.stringify({ EntityId: quoteId }) },
    { Module: "SalesManagement", PrimaryKey: quoteId, Data: "" },
  ];
  for (const attempt of attempts) {
    try {
      const envelope = await acGetData({
        Module: attempt.Module,
        Code: QUOTE_ACTION.taxDropdown,
        PrimaryKey: attempt.PrimaryKey,
        Data: attempt.Data,
        Action: QUOTE_ACTION.taxDropdown,
      });
      const parsed = envelopeValue(envelope);
      const source =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? ((parsed as Record<string, unknown>).TaxDetail ?? parsed)
          : parsed;
      const options = asLookupOptions(source);
      if (options.length > 0) return options;
    } catch {
      // Try the next live TAXDROPDOWN shape.
    }
  }
  return [];
}

export async function listDiscountTypes(): Promise<LookupOption[]> {
  const rows = await getListFirst([
    { host: "MASTER", path: "FnGetDropdown(dropdownCode='DISCOUNTVARIANT',startWith='')" },
    { host: "MASTER", path: "FnGetDropdown?dropdownCode=DISCOUNTVARIANT&startWith=" },
  ]);
  const seen = new Set<string>();
  const types: LookupOption[] = [];
  for (const row of rows) {
    const id = canonicalDiscountTypeId(row.id, row.label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    types.push({
      ...row,
      id,
      label: id === "INLINEDISCOUNT" ? "Inline" : row.label || discountTypeLabel(id),
    });
  }
  if (!types.some((row) => row.id === "INLINEDISCOUNT")) {
    types.unshift({ id: "INLINEDISCOUNT", label: "Inline" });
  }
  if (!types.some((row) => row.id === "VOUCHERDISCOUNT")) {
    types.push({ id: "VOUCHERDISCOUNT", label: "Voucher" });
  }
  types.sort((a, b) => {
    if (a.id === "INLINEDISCOUNT") return -1;
    if (b.id === "INLINEDISCOUNT") return 1;
    return a.label.localeCompare(b.label);
  });
  return types;
}

export async function listDiscountCatalog(
  quoteId: string,
  discountType: string,
  itemId?: string,
): Promise<LookupOption[]> {
  const body: Record<string, unknown> = {
    DiscountType: discountType,
    DiscountableOn: itemId ? "ITEMDISC" : "TOTDISC",
    EntityId: quoteId,
  };
  if (itemId) body.IncludeItems = [itemId];
  const envelope = await tebRequest("MICRO", "gateway/order/GetDiscountDetailDropDown", {
    method: "POST",
    body,
  });
  return asLookupOptions(envelope.Data ?? envelope.Value ?? envelope.value ?? envelope);
}

export async function listDiscountVouchers(quoteId: string): Promise<LookupOption[]> {
  return listDiscountCatalog(quoteId, "VOUCHERDISCOUNT");
}

async function fetchQuoteItemView(quoteId: string, action: string): Promise<QuoteItemView> {
  const modules = [QUOTE_MODULE.estimation, "SalesManagement"];
  let lastEmpty: QuoteItemView = { ItemDetail: [], Group: [], TotalSummary: null };
  for (const moduleName of modules) {
    try {
      const envelope = await acGetData({
        Module: moduleName,
        Code: action,
        PrimaryKey: quoteId,
        Data: "",
        Action: action,
      });
      const parsed = envelopeValue(envelope);
      let view: QuoteItemView = { ItemDetail: [], Group: [], TotalSummary: null };
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        view = {
          ItemDetail: Array.isArray(obj.ItemDetail) ? (obj.ItemDetail as Record<string, unknown>[]) : [],
          Group: Array.isArray(obj.Group) ? obj.Group : [],
          TotalSummary: obj.TotalSummary,
        };
      } else if (Array.isArray(parsed)) {
        view = { ItemDetail: parsed as Record<string, unknown>[], Group: [], TotalSummary: null };
      }
      const filled = view.ItemDetail.filter((row) => String(row.ItemName ?? row.Item ?? "").trim());
      if (filled.length > 0) return { ...view, ItemDetail: filled };
      lastEmpty = view;
    } catch {
      // Try the next module.
    }
  }
  return lastEmpty;
}

/** Live getItems uses VIEWCONSUMEDITEM; VIEWITEM is the grid ApiCall fallback. */
export async function loadQuoteItems(quoteId: string): Promise<QuoteItemView> {
  try {
    const consumed = await fetchQuoteItemView(quoteId, QUOTE_ACTION.viewConsumedItem);
    if (consumed.ItemDetail.length > 0) return consumed;
  } catch {
    // Fall through to VIEWITEM.
  }
  return fetchQuoteItemView(quoteId, QUOTE_ACTION.viewItem);
}

function omitEmptyGuids(row: Record<string, unknown>) {
  for (const [key, value] of Object.entries(row)) {
    if (value !== "" && value != null) continue;
    if (/Id$/i.test(key) || key === "Id" || key === "PriceSchemeId") delete row[key];
  }
}

function itemRowFromPayload(item: QuoteLinePayload): Record<string, unknown> {
  const row: Record<string, unknown> = {
    ItemId: item.ItemId,
    ItemName: item.ItemName ?? "",
    PricePerUnit: item.PricePerUnit ?? item.UnitPrice ?? 0,
    Quantity: item.Quantity ?? 1,
    OverrideQuantity: item.OverrideQuantity ?? "",
    Discount: item.Discount ?? 0,
    DiscountValueType: item.DiscountValueType ?? "PERCENTAGE",
    DiscountType: item.DiscountType ?? "INLINEDISCOUNT",
  };
  if (item.SequenceNo != null) row.SequenceNo = item.SequenceNo;
  if (item.Id) row.Id = item.Id;
  if (item.UnitId) row.UnitId = item.UnitId;
  if (item.PriceSchemeId) row.PriceSchemeId = item.PriceSchemeId;
  if (item.DiscountId) row.DiscountId = item.DiscountId;
  if (item.TaxId) row.TaxId = item.TaxId;
  if (item.TaxIds && item.TaxIds.length > 0) {
    row.TaxIds = item.TaxIds;
    row.Taxes = item.TaxIds.map((id) => ({ TaxId: id }));
  }
  if (item.Tax != null) row.Tax = item.Tax;
  if (item.PriceType) row.PriceType = item.PriceType;
  omitEmptyGuids(row);
  return row;
}

function wizardItemRow(row: Record<string, unknown>): Record<string, unknown> {
  const wizard: Record<string, unknown> = {
    ItemId: row.ItemId,
    PricePerUnit: row.PricePerUnit,
    Quantity: row.Quantity,
    OverrideQuantity: row.OverrideQuantity ?? "",
  };
  if (row.PriceSchemeId) wizard.PriceSchemeId = row.PriceSchemeId;
  if (row.UnitId) wizard.UnitId = row.UnitId;
  return wizard;
}

function addDetailFailed(envelope: { Succeeded?: boolean; Messages?: string[]; error?: string }, fallback: string): Error | null {
  if (envelope.Succeeded !== false) return null;
  const message =
    Array.isArray(envelope.Messages) && envelope.Messages[0] ? envelope.Messages[0] : envelope.error || fallback;
  return new TebApiError(message, 400, envelope);
}

/** Quote lines post via EstimationManagement ADDITEM. SalesManagement 500s on quotes. */
export async function saveQuoteItem(quoteId: string, item: QuoteLinePayload): Promise<void> {
  const row = itemRowFromPayload(item);
  if (!row.ItemId) return;
  const attempts: Array<{ Code: string; Action: string; Data: string }> = [
    {
      Code: QUOTE_ACTION.addItem,
      Action: QUOTE_ACTION.addItem,
      Data: JSON.stringify(row),
    },
    {
      Code: QUOTE_ACTION.addItem,
      Action: QUOTE_ACTION.addItem,
      Data: JSON.stringify({ ...row, EntityId: quoteId }),
    },
    {
      Code: QUOTE_MODULE.screenItem,
      Action: QUOTE_ACTION.addMultipleItem,
      Data: JSON.stringify({ EntityId: quoteId, ItemDetail: [wizardItemRow(row)] }),
    },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const envelope = await acAddDetail({
        Module: QUOTE_MODULE.estimation,
        Code: attempt.Code,
        Action: attempt.Action,
        PrimaryKey: quoteId,
        Data: attempt.Data,
      });
      const failed = addDetailFailed(envelope, "Could not save the item.");
      if (failed) {
        lastError = failed;
        continue;
      }
      return;
    } catch (err) {
      lastError = err;
      if (err instanceof TebApiError && err.status > 0 && err.status < 500) break;
    }
  }
  throw lastError instanceof Error ? lastError : new TebApiError("Could not save the item.", 400);
}

export async function saveQuoteItems(quoteId: string, items: QuoteLinePayload[]): Promise<void> {
  for (const item of items.filter((row) => row.ItemId)) {
    await saveQuoteItem(quoteId, item);
  }
}

async function addDetailWithModules(code: string, quoteId: string, data: unknown): Promise<void> {
  const modules = [QUOTE_MODULE.estimation, "SalesManagement"];
  let lastError: unknown = null;
  for (const moduleName of modules) {
    try {
      const envelope = await acAddDetail({
        Module: moduleName,
        Code: code,
        Action: code,
        PrimaryKey: quoteId,
        Data: JSON.stringify(data),
      });
      const failed = addDetailFailed(envelope, `Could not run ${code}.`);
      if (failed) {
        lastError = failed;
        continue;
      }
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new TebApiError(`Could not run ${code}.`, 400);
}

/** Quote item tax stays on EstimationManagement (same as ADDITEM). SalesManagement 500s with a generic admin message. */
async function addQuoteDetail(
  moduleName: string,
  code: string,
  quoteId: string,
  data: unknown,
  action = code,
): Promise<void> {
  const envelope = await acAddDetail({
    Module: moduleName,
    Code: code,
    Action: action,
    PrimaryKey: quoteId,
    Data: JSON.stringify(data),
  });
  const failed = addDetailFailed(envelope, `Could not run ${action}.`);
  if (failed) throw failed;
}

export async function removeQuoteItem(quoteId: string, itemEntityId: string): Promise<void> {
  await addDetailWithModules(QUOTE_ACTION.removeItem, quoteId, { EntityId: quoteId, ItemEntityId: itemEntityId });
}

export async function applyQuoteItemTax(quoteId: string, itemEntityId: string, taxId: string): Promise<void> {
  const dataShapes: unknown[] = [
    { EntityId: quoteId, EntityItemId: itemEntityId, TaxId: taxId },
    { EntityId: quoteId, EntityItemId: itemEntityId, TaxId: [taxId] },
    { OpportunityId: quoteId, OpportunityItemId: itemEntityId, TaxId: taxId },
  ];
  const posts = [
    { code: QUOTE_ACTION.addItemTax, action: QUOTE_ACTION.addItemTax },
    { code: QUOTE_MODULE.screenItem, action: QUOTE_ACTION.addItemTax },
  ];
  let lastError: unknown = null;
  for (const post of posts) {
    for (const data of dataShapes) {
      try {
        await addQuoteDetail(QUOTE_MODULE.estimation, post.code, quoteId, data, post.action);
        return;
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new TebApiError("Could not apply the tax.", 400);
}

export async function removeQuoteItemTax(quoteId: string, itemEntityId: string, taxId: string): Promise<void> {
  const shapes = [
    { OpportunityId: quoteId, OpportunityItemId: itemEntityId, TaxId: taxId },
    { EntityId: quoteId, EntityItemId: itemEntityId, TaxId: taxId },
    { QuoteId: quoteId, QuoteItemId: itemEntityId, TaxId: taxId },
  ];
  let lastError: unknown = null;
  for (const data of shapes) {
    try {
      await addQuoteDetail(QUOTE_MODULE.estimation, QUOTE_ACTION.removeItemTax, quoteId, data);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new TebApiError("Could not remove the tax.", 400);
}
