import { tebRequest } from "@/lib/api/client";
import type { TebHostKey } from "@/lib/api/hosts";
import type { TebApiEnvelope } from "@/lib/api/types";
import { asLookupOptions, searchItems, type LookupOption } from "@/lib/api/quote-lookups";
import { acGetData } from "@/lib/api/quote";
import type { FilterControl, FilterExtraApi, FilterScreen, FilterTab, ReportingFilterDetail } from "@/lib/chat/types";

function unwrapUnknown(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw === "string") {
    try {
      return unwrapUnknown(JSON.parse(raw));
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function lookupFirst(attempts: Array<{ host: TebHostKey; path: string }>): Promise<LookupOption[]> {
  for (const attempt of attempts) {
    try {
      const envelope = await tebRequest(attempt.host, attempt.path);
      const rows = asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
      if (rows.length > 0) return rows;
    } catch {
      // Try the next known live path.
    }
  }
  return [];
}

function asArray<T>(raw: unknown): T[] {
  const parsed = unwrapUnknown(raw);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function hostFromApi(api?: string): TebHostKey {
  const key = String(api || "").toUpperCase();
  if (key === "USER") return "USER";
  if (key === "COMPANY") return "COMPANY";
  if (key === "MASTER") return "MASTER";
  if (key === "DYNAMIC") return "DYNAMIC";
  if (key === "TEMPLATE") return "TEMPLATE";
  return "MICRO";
}

async function fetchFilterScreen(moduleCode: string, screenCode: string): Promise<FilterScreen> {
  const envelope = await tebRequest<{
    Tabs?: FilterTab[];
    Controls?: FilterControl[];
    ExtraApi?: FilterExtraApi[];
    ExtraApiCall?: FilterExtraApi[];
  }>("MICRO", "gateway/admin/GetFilterControls", {
    method: "POST",
    body: { ModuleCode: moduleCode, ScreenCode: screenCode },
  });
  const data = unwrapUnknown(envelope.Data ?? envelope) as Record<string, unknown>;
  if (Array.isArray(data)) {
    return { Tabs: data as FilterTab[], Controls: [], ExtraApi: [] };
  }
  const obj = data && typeof data === "object" ? data : {};
  return {
    Tabs: asArray<FilterTab>(obj.Tabs),
    Controls: asArray<FilterControl>(obj.Controls),
    ExtraApi: asArray<FilterExtraApi>(obj.ExtraApi ?? obj.ExtraApiCall),
  };
}

export async function getFilterScreen(moduleCode: string, screenCode = "MANAGE"): Promise<FilterScreen> {
  const codes = [moduleCode === "LeadManagement" ? "MANAGE" : screenCode];
  if (moduleCode === "EstimationManagement") codes.push("QUOTEFILTER", "QUOTE");
  if (moduleCode === "SalesManagement") codes.push("OPPORTUNITYFILTER");
  if (moduleCode === "OrderManagement") codes.push("ORDERFILTER", "ORDER");
  if (moduleCode === "InvoiceManagement") codes.push("INVOICEFILTER", "INVOICE");
  if (moduleCode === "ActionManagement") codes.push("ACTIONFILTER", "ACTION");
  if (moduleCode === "TicketManagement") codes.push("TICKETFILTER", "TICKET", "MANAGETICKET");
  if (moduleCode === "WorkOrderManagement") codes.push("WORKORDERFILTER", "WORKORDER", "MANAGEWORKORDER");
  let last: FilterScreen = { Tabs: [], Controls: [], ExtraApi: [] };
  for (const code of codes) {
    try {
      last = await fetchFilterScreen(moduleCode, code);
      if (last.Tabs.length > 0) return last;
    } catch {
      // Next known ScreenCode for this module.
    }
  }
  return last;
}

export async function getFilterControls(moduleCode: string, screenCode = "MANAGE"): Promise<FilterTab[]> {
  const screen = await getFilterScreen(moduleCode, screenCode);
  return screen.Tabs;
}

export async function loadExtraApiOptions(
  api: FilterExtraApi,
  context: Record<string, unknown> = {},
): Promise<LookupOption[]> {
  const call = api.ApiCall;
  if (!call?.Method) return [];
  const host = hostFromApi(call.Api);
  const method = String(call.Type || "GET").toUpperCase();
  try {
    const envelope = await tebRequest(
      host,
      call.Method,
      method === "GET" ? undefined : { method: "POST", body: context },
    );
    return asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
  } catch {
    return [];
  }
}

export async function loadMasterByCode(startWith: string): Promise<LookupOption[]> {
  return lookupFirst([
    { host: "MASTER", path: `FnGetDropdown()?dropdownCode=MASTERBYCODE&startWith=${encodeURIComponent(startWith)}` },
    { host: "MASTER", path: `FnGetDropdown?dropdownCode=MASTERBYCODE&startWith=${encodeURIComponent(startWith)}` },
  ]);
}

/** Live product catalog used by Opportunity / Quote / Order / Invoice item filters. */
export async function searchCatalogItems(keyword: string): Promise<LookupOption[]> {
  if (!keyword.trim()) return [];
  return searchItems(keyword.trim());
}

export async function searchCatalogFacet(action: string, keyword = ""): Promise<LookupOption[]> {
  try {
    const envelope = await acGetData({
      Module: "ProductsManagement",
      Code: "ITEM",
      PrimaryKey: "",
      Data: JSON.stringify({ Search: keyword, ParentId: "", CategoryId: "", BrandId: "" }),
      Action: action,
    });
    const rows = asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
    if (rows.length > 0) return rows;
  } catch {
    // MASTERBYCODE is the next live path.
  }
  return [];
}

export async function listSavedFilters(dynamicModule: string, componentCode = "MANAGE"): Promise<LookupOption[]> {
  try {
    const envelope = await tebRequest("MASTER", "AcGetSusbcriberFilterList", {
      method: "POST",
      body: { data: { ComponentCode: componentCode, Module: dynamicModule } },
    });
    return asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
  } catch {
    return [];
  }
}

export async function listWorkflowsForModule(modules: string[]): Promise<LookupOption[]> {
  const attempts: Array<{ host: TebHostKey; path: string }> = [];
  for (const moduleName of modules) {
    attempts.push(
      { host: "COMPANY", path: `FnGetWorkFlowDropdown?module=${encodeURIComponent(moduleName)}` },
      { host: "COMPANY", path: `FnGetWorkflowByModule?moduleName=${encodeURIComponent(moduleName)}` },
      { host: "MICRO", path: `gateway/common/GetAllWorkflowList?module=${encodeURIComponent(moduleName)}` },
    );
  }
  return lookupFirst(attempts);
}

export async function listWorkflowStages(workflowId: string, listModule: string): Promise<LookupOption[]> {
  const query = `workflowId=${encodeURIComponent(workflowId)}&module=${encodeURIComponent(listModule)}`;
  const rows = await lookupFirst([
    { host: "COMPANY", path: `FnGetWorkFlowStatusWithWonLostDropdown?${query}` },
    { host: "MASTER", path: `AcGetWorkFlowStepsByWorkflow?workflowId=${encodeURIComponent(workflowId)}` },
    { host: "MASTER", path: `AcGetWorkFlowStepsByWorkflow()?workflowId=${encodeURIComponent(workflowId)}` },
  ]);
  return rows.map((row) => {
    const extra = row.extra ?? {};
    const id =
      String(extra.StatusId ?? extra.WorkFlowStatusId ?? extra.Code ?? extra.Id ?? row.id ?? "").trim() || row.id;
    return { ...row, id };
  });
}

export async function postReporting<T = unknown>(
  method: string,
  body: ReportingFilterDetail | Record<string, unknown>,
): Promise<TebApiEnvelope<T>> {
  return tebRequest<T>("MICRO", `gateway/reporting/${method}`, {
    method: "POST",
    body,
    timeoutMs: 30000,
  });
}

const FALLBACK_TABS: FilterTab[] = [
  { Code: "OWNER", Title: "Owner", TabViewType: "MULTISELECT", DbFieldName: "ownerid" },
  { Code: "ASSIGNEDTO", Title: "Assigned to", TabViewType: "MULTISELECT", DbFieldName: "assigneeid" },
  { Code: "WORKFLOW", Title: "Workflow", TabViewType: "TREESELECT", DbFieldName: "workflowid" },
  { Code: "DATE", Title: "Date", TabViewType: "DATEVIEW", DbFieldName: "createddate" },
  { Code: "LOCATION", Title: "Location", TabViewType: "MULTISELECT", DbFieldName: "locationid" },
  { Code: "ITEM", Title: "Item", TabViewType: "MULTISELECT", DbFieldName: "itemid" },
  { Code: "CATEGORY", Title: "Category", TabViewType: "MULTISELECT", DbFieldName: "categoryid" },
  { Code: "BRAND", Title: "Brand", TabViewType: "MULTISELECT", DbFieldName: "brandid" },
  { Code: "SKU", Title: "SKU", TabViewType: "MULTISELECT", DbFieldName: "sku" },
  { Code: "MODEL", Title: "Model", TabViewType: "MULTISELECT", DbFieldName: "modelid" },
  { Code: "TYPE", Title: "Type", TabViewType: "MULTISELECT", DbFieldName: "typeid" },
  { Code: "CURRENCY", Title: "Currency", TabViewType: "MULTISELECT", DbFieldName: "currencyid" },
  { Code: "CONTACT", Title: "Contact", TabViewType: "MULTISELECT", DbFieldName: "contactid" },
  { Code: "QUOTECODE", Title: "Quote No.", TabViewType: "INPUTFIELD", DbFieldName: "quotecode" },
  { Code: "ORDERCODE", Title: "Order No.", TabViewType: "INPUTFIELD", DbFieldName: "ordercode" },
  { Code: "INVOICECODE", Title: "Invoice No.", TabViewType: "INPUTFIELD", DbFieldName: "invoicecode" },
  { Code: "ACTIONTYPE", Title: "Action Type", TabViewType: "MULTISELECT", DbFieldName: "actiontype" },
  { Code: "PRIORITY", Title: "Priority", TabViewType: "MULTISELECT", DbFieldName: "priorityid" },
  { Code: "TITLE", Title: "Title", TabViewType: "INPUTFIELD", DbFieldName: "title" },
  { Code: "TICKETCODE", Title: "Ticket No.", TabViewType: "INPUTFIELD", DbFieldName: "ticketcode" },
  { Code: "WORKORDERCODE", Title: "Work Order No.", TabViewType: "INPUTFIELD", DbFieldName: "workordercode" },
  { Code: "ASSET", Title: "Asset", TabViewType: "MULTISELECT", DbFieldName: "assetid" },
  { Code: "SLA", Title: "SLA", TabViewType: "MULTISELECT", DbFieldName: "slaid" },
  { Code: "CHANNEL", Title: "Channel", TabViewType: "MULTISELECT", DbFieldName: "channelid" },
];

export function fallbackFilterTabs(): FilterTab[] {
  return FALLBACK_TABS.map((tab) => ({ ...tab }));
}
