import { tebRequest } from "@/lib/api/client";
import type { TebHostKey } from "@/lib/api/hosts";
import type { TebApiEnvelope } from "@/lib/api/types";
import { asLookupOptions, searchItems, type LookupOption } from "@/lib/api/quote-lookups";
import { acGetData } from "@/lib/api/dynamic";
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

const FILTER_MODULE_ALIASES: Record<string, string[]> = {
  TicketManagement: ["TEBTicket", "TicketManagement"],
  WorkOrderManagement: ["TEBWorkorder", "WorkOrderManagement", "WorkorderManagement"],
  EstimationManagement: ["EstimationManagement", "TEBQuote"],
  LeadManagement: ["LeadManagement", "TEBLead"],
  SalesManagement: ["SalesManagement", "TEBSale"],
  OrderManagement: ["OrderManagement", "TEBOrder"],
  InvoiceManagement: ["InvoiceManagement", "TEBInvoice"],
  ActionManagement: ["ActionManagement", "TEBAction"],
  TEBBusiness: ["TEBBusiness", "BusinessContactManagement"],
  TEBPeople: ["TEBPeople", "BusinessContactManagement"],
  BusinessContactManagement: ["TEBBusiness", "TEBPeople", "BusinessContactManagement"],
};

const EXTRA_TAB_META: Record<string, Pick<FilterTab, "Title" | "TabViewType" | "DbFieldName">> = {
  OWNER: { Title: "Owner", TabViewType: "MULTISELECT", DbFieldName: "ownerid" },
  ASSIGNEDTO: { Title: "Assigned to", TabViewType: "MULTISELECT", DbFieldName: "assigneeid" },
  PRIORITY: { Title: "Priority", TabViewType: "MULTISELECT", DbFieldName: "priorityid" },
  INTERNALPRIORITY: { Title: "Internal priority", TabViewType: "MULTISELECT", DbFieldName: "internalpriorityid" },
  TYPE: { Title: "Type", TabViewType: "MULTISELECT", DbFieldName: "typeid" },
  CHANNEL: { Title: "Channel", TabViewType: "MULTISELECT", DbFieldName: "channelid" },
  SITE: { Title: "Site", TabViewType: "MULTISELECT", DbFieldName: "locationid" },
  ASSET: { Title: "Asset", TabViewType: "MULTISELECT", DbFieldName: "assetid" },
  SLA: { Title: "SLA", TabViewType: "MULTISELECT", DbFieldName: "slaid" },
  TICKETCODE: { Title: "Ticket no.", TabViewType: "INPUTFIELD", DbFieldName: "ticketcode" },
  WORKORDERCODE: { Title: "Work order no.", TabViewType: "INPUTFIELD", DbFieldName: "workordercode" },
  INDUSTRY: { Title: "Industry", TabViewType: "MULTISELECT", DbFieldName: "industryid" },
  SECTOR: { Title: "Sector", TabViewType: "MULTISELECT", DbFieldName: "sectorid" },
  RELATIONSHIPTYPE: { Title: "Relationship", TabViewType: "MULTISELECT", DbFieldName: "relationshiptypeid" },
  CONTACTTYPE: { Title: "Contact type", TabViewType: "MULTISELECT", DbFieldName: "contacttypeid" },
  SOURCE: { Title: "Source", TabViewType: "MULTISELECT", DbFieldName: "sourceid" },
  SOURCECATEGORY: { Title: "Source category", TabViewType: "MULTISELECT", DbFieldName: "sourcecategoryid" },
};

function screenCodesFor(moduleCode: string, screenCode: string): string[] {
  const codes = [moduleCode === "LeadManagement" ? "MANAGE" : screenCode];
  if (moduleCode === "EstimationManagement") codes.push("QUOTEFILTER", "QUOTE");
  if (moduleCode === "SalesManagement") codes.push("OPPORTUNITYFILTER");
  if (moduleCode === "OrderManagement") codes.push("ORDERFILTER", "ORDER");
  if (moduleCode === "InvoiceManagement") codes.push("INVOICEFILTER", "INVOICE");
  if (moduleCode === "ActionManagement") codes.push("ACTIONFILTER", "ACTION");
  if (moduleCode === "TicketManagement") codes.push("TICKETFILTER", "TICKET", "MANAGETICKET", "MANAGETICKETFILTER");
  if (moduleCode === "WorkOrderManagement") codes.push("WORKORDERFILTER", "WORKORDER", "MANAGEWORKORDER", "MANAGEWORKORDERFILTER");
  if (moduleCode === "TEBBusiness" || moduleCode === "BusinessContactManagement") {
    codes.push("COMPANYFILTER", "MANAGECOMPANY", "MANAGE");
  }
  if (moduleCode === "TEBPeople") codes.push("CONTACTFILTER", "MANAGECONTACT", "MANAGE");
  return [...new Set(codes)];
}

function enrichFilterScreen(screen: FilterScreen): FilterScreen {
  const have = new Set(screen.Tabs.map((tab) => String(tab.Code || "").toUpperCase()));
  const tabs = [...screen.Tabs];
  for (const api of screen.ExtraApi) {
    const code = String(api.Code || "");
    const upper = code.toUpperCase();
    if (!code || have.has(upper)) continue;
    const meta = EXTRA_TAB_META[upper];
    if (!meta) continue;
    tabs.push({
      Code: code,
      Title: meta.Title,
      TabViewType: meta.TabViewType,
      DbFieldName: meta.DbFieldName,
      Fields: [code],
    });
    have.add(upper);
  }
  return { ...screen, Tabs: tabs };
}

function extraApiParams(
  paramName: Array<{ Name?: string; Property?: string; Type?: string }> | undefined,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const row of paramName ?? []) {
    const name = String(row.Name || "").trim();
    if (!name) continue;
    if (String(row.Type || "").toUpperCase() === "FIXED") {
      params[name] = row.Property ?? "";
    } else {
      const key = String(row.Property || name);
      if (context[key] != null) params[name] = context[key];
      else if (context[name] != null) params[name] = context[name];
    }
  }
  const search = String(context.SearchText ?? context.SearchKey ?? context.startWith ?? "").trim();
  if (search && (params.startWith === "" || params.startWith == null)) params.startWith = search;
  if (Object.keys(params).length === 0) return { ...context };
  return params;
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
  const modules = FILTER_MODULE_ALIASES[moduleCode] ?? [moduleCode];
  const codes = screenCodesFor(moduleCode, screenCode);
  let last: FilterScreen = { Tabs: [], Controls: [], ExtraApi: [] };
  for (const mod of modules) {
    for (const code of codes) {
      try {
        last = await fetchFilterScreen(mod, code);
        if (last.Tabs.length > 0) return enrichFilterScreen(last);
      } catch {
        // Next ModuleCode / ScreenCode pair used by live managefilter.
      }
    }
  }
  return last.Tabs.length > 0 ? enrichFilterScreen(last) : last;
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
  const params = extraApiParams(call.ParamName, context);
  try {
    let envelope: TebApiEnvelope;
    if (method === "GET") {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value == null || value === "") continue;
        query.set(key, String(value));
      }
      const suffix = query.toString();
      envelope = await tebRequest(host, suffix ? `${call.Method}?${suffix}` : call.Method);
    } else {
      envelope = await tebRequest(host, call.Method, { method: "POST", body: params });
    }
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

function nodeId(row: Record<string, unknown>): string {
  return String(row.Id ?? row.id ?? row.StatusId ?? row.WorkFlowStatusId ?? row.WorkflowId ?? row.WorkFlowId ?? "").trim();
}

function nodeLabel(row: Record<string, unknown>): string {
  return String(
    row.Text ??
      row.Name ??
      row.Title ??
      row.Label ??
      row.StatusName ??
      row.WorkFlowStatus ??
      row.WorkFlowName ??
      row.WorkflowName ??
      "",
  ).trim();
}

function nodeChildren(row: Record<string, unknown>): Record<string, unknown>[] {
  const raw = row.Children ?? row.children ?? row.data ?? row.Data ?? row.Stages ?? row.Status;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function walkWorkflowTree(
  nodes: unknown[],
  parentId: string,
  workflows: LookupOption[],
  stages: Array<LookupOption & { workflowId: string }>,
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as Record<string, unknown>;
    const id = nodeId(row);
    const label = nodeLabel(row) || id;
    if (!id) continue;
    const declaredParent = String(row.ParentId ?? row.parentId ?? "").trim();
    const parent = declaredParent || parentId;
    const children = nodeChildren(row);
    if (!parent) {
      workflows.push({ id, label, extra: row });
      if (children.length) walkWorkflowTree(children, id, workflows, stages);
      continue;
    }
    stages.push({ id, label, extra: row, workflowId: parent });
    if (children.length) walkWorkflowTree(children, parent, workflows, stages);
  }
}

/** Live FILTER tree: roots are workflows, children are stages (ParentId). */
export async function loadWorkflowStageTree(
  modules: string[],
): Promise<{ workflows: LookupOption[]; stages: Array<LookupOption & { workflowId: string }> }> {
  const workflows: LookupOption[] = [];
  const stages: Array<LookupOption & { workflowId: string }> = [];
  const seen = new Set<string>();
  for (const moduleName of modules) {
    if (!moduleName || seen.has(moduleName)) continue;
    seen.add(moduleName);
    const attempts: Array<{ path: string; method?: "GET" | "POST"; body?: unknown }> = [
      { path: `gateway/common/GetWorkflowStageTree?Module=${encodeURIComponent(moduleName)}` },
      { path: "gateway/common/GetWorkflowStageTree", method: "POST", body: { Module: moduleName } },
    ];
    for (const attempt of attempts) {
      try {
        const envelope = await tebRequest(
          "MICRO",
          attempt.path,
          attempt.method === "POST" ? { method: "POST", body: attempt.body } : undefined,
        );
        const raw = unwrapUnknown(envelope.Data ?? envelope.value ?? envelope.Value ?? envelope);
        const rows = Array.isArray(raw)
          ? raw
          : raw && typeof raw === "object"
            ? ((raw as Record<string, unknown>).Data as unknown[]) ||
              ((raw as Record<string, unknown>).data as unknown[]) ||
              []
            : [];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        walkWorkflowTree(rows, "", workflows, stages);
        if (workflows.length > 0 || stages.length > 0) return { workflows, stages };
      } catch {
        // Next module / method.
      }
    }
  }
  return { workflows, stages };
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

const PARTY_FALLBACK_TABS: FilterTab[] = [
  { Code: "OWNER", Title: "Owner", TabViewType: "MULTISELECT", DbFieldName: "ownerid" },
  { Code: "LOCATION", Title: "Location", TabViewType: "MULTISELECT", DbFieldName: "locationid" },
  { Code: "INDUSTRY", Title: "Industry", TabViewType: "MULTISELECT", DbFieldName: "industryid" },
  { Code: "SECTOR", Title: "Sector", TabViewType: "MULTISELECT", DbFieldName: "sectorid" },
  { Code: "RELATIONSHIPTYPE", Title: "Relationship", TabViewType: "MULTISELECT", DbFieldName: "relationshiptypeid" },
  { Code: "CONTACTTYPE", Title: "Contact type", TabViewType: "MULTISELECT", DbFieldName: "contacttypeid" },
  { Code: "SOURCE", Title: "Source", TabViewType: "MULTISELECT", DbFieldName: "sourceid" },
  { Code: "SOURCECATEGORY", Title: "Source category", TabViewType: "MULTISELECT", DbFieldName: "sourcecategoryid" },
  { Code: "DATE", Title: "Date", TabViewType: "DATEVIEW", DbFieldName: "createddate" },
  { Code: "WORKFLOW", Title: "Workflow", TabViewType: "TREESELECT", DbFieldName: "workflowid" },
];

export function fallbackPartyFilterTabs(kind?: "COMPANY" | "CONTACT"): FilterTab[] {
  const tabs = PARTY_FALLBACK_TABS.map((tab) => ({ ...tab }));
  if (kind === "CONTACT") {
    tabs.splice(1, 0, { Code: "COMPANY", Title: "Company", TabViewType: "MULTISELECT", DbFieldName: "companyid" });
  }
  return tabs;
}
