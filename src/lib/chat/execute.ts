import { listManageRecords } from "@/lib/api/manage-grid";
import {
  fallbackFilterTabs,
  getFilterScreen,
  listSavedFilters,
  listWorkflowStages,
  listWorkflowsForModule,
  loadExtraApiOptions,
  loadMasterByCode,
  postReporting,
  searchCatalogFacet,
  searchCatalogItems,
} from "@/lib/api/filters";
import { listLocations, listOwners, listQuoteTypes, listCurrencies, ownerFromUser, getSubscriberUserCurrency, searchCompanies, searchContacts, type LookupOption } from "@/lib/api/quote-lookups";
import { aliasFamily, matchTab, tabPhrases } from "@/lib/chat/filter-fields";
import { TebApiError, type TebUserDetail } from "@/lib/api/types";
import { REPORT_ENTITIES, type ReportEntity } from "@/lib/chat/entities";
import { HELP_TEXT, isDashboardQuestion, isGreeting, parseQuestion } from "@/lib/chat/parse";
import type { ChatHistoryTurn } from "@/lib/chat/journey";
import { dateWindow, modeLabel, periodProperty, toLiveDateFilter } from "@/lib/chat/date-filter";
import { buildDatasetSummary, localAnalysis, pickCharts, rowDate, rowOwner, rowStatus, rowTitle } from "@/lib/chat/charts";
import type {
  FilterScreen,
  FilterTab,
  FilterValueRow,
  ReportIntent,
  ReportResult,
  ReportingFilterDetail,
} from "@/lib/chat/types";
import { formatAmount } from "@/lib/money";
import { runWorkforceReport } from "@/lib/chat/workforce-report";
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_SUGGESTIONS,
  buildDashboardFilter,
  dashboardCharts,
  dashboardHelpResult,
  fetchEntityDashboard,
  fetchTeamSnapshot,
  looksLikeSnapshot,
  resolveDashboardOwners,
} from "@/lib/chat/dashboard-report";

function emptyResult(
  partial: Omit<ReportResult, "analysis" | "charts" | "amount" | "metric" | "currencySymbol" | "currencyCode"> &
    Partial<Pick<ReportResult, "amount" | "metric" | "currencySymbol" | "currencyCode" | "map" | "paths" | "mapTitle">>,
): ReportResult {
  return {
    analysis: "",
    charts: [],
    ...partial,
    amount: partial.amount ?? 0,
    metric: partial.metric ?? "count",
    currencySymbol: partial.currencySymbol ?? "",
    currencyCode: partial.currencyCode ?? "",
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchLookups(options: LookupOption[], needle: string): LookupOption[] {
  const want = normalize(needle);
  if (!want) return [];
  const exact = options.filter((option) => normalize(option.label) === want || option.id === needle);
  if (exact.length > 0) return exact;
  const starts = options.filter((option) => normalize(option.label).startsWith(want));
  if (starts.length === 1) return starts;
  const contains = options.filter((option) => normalize(option.label).includes(want));
  return contains;
}

function pickBest(matches: LookupOption[], needle: string): LookupOption | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const want = normalize(needle);
  return (
    matches.find((option) => normalize(option.label) === want) ??
    [...matches].sort((a, b) => a.label.length - b.label.length)[0]
  );
}

function tabCode(tab: FilterTab): string {
  return String(tab.Code || "").toUpperCase();
}

function tabType(tab: FilterTab): string {
  return String(tab.TabViewType || tab.CustomControlType || "").toUpperCase();
}

function isOwnerTab(tab: FilterTab): boolean {
  const code = tabCode(tab);
  return code.includes("OWNER") && !code.includes("CREATED");
}

function isAssigneeTab(tab: FilterTab): boolean {
  const code = tabCode(tab);
  return code.includes("ASSIGN");
}

function isLocationTab(tab: FilterTab): boolean {
  const code = tabCode(tab);
  return code.includes("LOCATION") || code.includes("SITE");
}

function isWorkflowTab(tab: FilterTab): boolean {
  return tabCode(tab).includes("WORKFLOW");
}

function isStatusTab(tab: FilterTab): boolean {
  const code = tabCode(tab);
  return code.includes("STATUS") && !code.includes("WORKFLOW");
}

function isDateTab(tab: FilterTab, fieldType: string): boolean {
  const code = tabCode(tab);
  const type = tabType(tab);
  if (type === "DATEVIEW" || code === "DATE") return true;
  if (fieldType === "UPDATEDFILTER") return code.includes("MODIFIED") || code.includes("UPDATED");
  if (fieldType === "CLOSEDFILTER") return code.includes("CLOSE");
  if (fieldType === "SCHEDULEFILTER") return code.includes("SCHEDULE");
  if (fieldType === "DUEFILTER") return code.includes("DUE");
  return code.includes("CREATED") || code.includes("DATE");
}

function multiValueRow(tab: FilterTab, ids: string[], selected?: unknown): FilterValueRow {
  return {
    TabCode: tab.Code,
    PropertyName: tab.DbFieldName || tab.Code.toLowerCase(),
    ControlType: "MULTIVALUE",
    LabelName: tab.Title,
    MultiValue: ids,
    SelectedValue: selected ?? ids,
    DateFilter: null,
  };
}

function buildFilterValues(
  tabs: FilterTab[],
  intent: ReportIntent,
  resolved: {
    ownerIds: string[];
    assigneeIds: string[];
    locationIds: string[];
    statusIds: string[];
    workflows: Array<{ id: string; stages: string[] }>;
    extras: Array<{ tab: FilterTab; ids: string[] }>;
  },
): FilterValueRow[] {
  const rows: FilterValueRow[] = [];
  const used = new Set<string>();
  for (const extra of resolved.extras) {
    const code = tabCode(extra.tab);
    if (used.has(code) || extra.ids.length === 0) continue;
    rows.push(multiValueRow(extra.tab, extra.ids));
    used.add(code);
  }
  for (const tab of tabs) {
    const code = tabCode(tab);
    if (used.has(code)) continue;
    if (isOwnerTab(tab) && resolved.ownerIds.length > 0) {
      rows.push(multiValueRow(tab, resolved.ownerIds));
      used.add(code);
      continue;
    }
    if (isAssigneeTab(tab) && resolved.assigneeIds.length > 0) {
      rows.push(multiValueRow(tab, resolved.assigneeIds));
      used.add(code);
      continue;
    }
    if (isLocationTab(tab) && resolved.locationIds.length > 0) {
      rows.push(multiValueRow(tab, resolved.locationIds));
      used.add(code);
      continue;
    }
    if (isStatusTab(tab) && resolved.statusIds.length > 0) {
      rows.push(multiValueRow(tab, resolved.statusIds));
      used.add(code);
      continue;
    }
    if (isWorkflowTab(tab) && resolved.workflows.length > 0) {
      const containers = resolved.workflows.map((workflow) => ({
        SingleValue: workflow.id,
        MultiValue: workflow.stages,
        Key: workflow.id,
        Values: workflow.stages,
      }));
      rows.push({
        TabCode: tab.Code,
        PropertyName: tab.DbFieldName || "workflowid",
        ControlType: "VALUECONTAIN",
        LabelName: tab.Title,
        ValueContainers: containers,
        SelectedValue: containers,
        DateFilter: null,
      });
      used.add(code);
      continue;
    }
    if (intent.date && isDateTab(tab, intent.date.fieldType)) {
      rows.push({
        TabCode: tab.Code || "DATE",
        PropertyName: periodProperty(intent.date.fieldType),
        ControlType: "DATE",
        LabelName: tab.Title || "Date",
        DateFilter: toLiveDateFilter(intent.date),
      });
      used.add(code);
    }
  }
  return rows;
}

async function loadScreen(dynamicModule: string): Promise<FilterScreen> {
  try {
    const screen = await getFilterScreen(dynamicModule, "MANAGE");
    if (screen.Tabs.length > 0) return screen;
  } catch {
    // Fallback tabs still apply owner / assignee / date / workflow.
  }
  return { Tabs: fallbackFilterTabs(), Controls: [], ExtraApi: [] };
}

async function loadTabOptions(
  screen: FilterScreen,
  tab: FilterTab,
  entity: ReportEntity,
  search = "",
): Promise<LookupOption[]> {
  const fieldCodes = tab.Fields?.length ? tab.Fields : [tab.Code];
  const apis = screen.ExtraApi.filter(
    (api) => fieldCodes.includes(api.Code) || api.Code === tab.Code || api.Code === tab.CustomFieldCode,
  );
  const loaded: LookupOption[] = [];
  for (const api of apis) {
    const rows = await loadExtraApiOptions(api, {
      Module: entity.dynamicModule,
      SearchKey: search || null,
      SearchKeyWord: search,
      SearchText: search || null,
    });
    loaded.push(...rows);
  }
  if (loaded.length > 0) return loaded;
  const family = aliasFamily(tab.Code || tab.Title || "");
  if (family === "owner" || family === "assignee") return listOwners();
  if (family === "location") return listLocations();
  if (family === "company" && search) return searchCompanies(search);
  if (family === "contact" && search) return searchContacts(search);
  if (family === "currency") return listCurrencies();
  if (family === "type") {
    if (entity.key === "action" || /ACTIONTYPE/i.test(tab.Code || tab.Title || "")) {
      return loadMasterByCode("ACTIONTYPE");
    }
    if (entity.key === "ticket" || /TICKETTYPE/i.test(tab.Code || tab.Title || "")) {
      return loadMasterByCode("TICKETTYPE");
    }
    if (entity.key === "workorder" || /WORKORDERTYPE/i.test(tab.Code || tab.Title || "")) {
      return loadMasterByCode("WORKORDERTYPE");
    }
    return listQuoteTypes();
  }
  if (family === "billinglocation" || family === "shippinglocation") return listLocations();
  if (family === "item") return searchCatalogItems(search);
  if (family === "category") {
    const rows = await searchCatalogFacet("GETCATEGORYDROPDOWN", search);
    if (rows.length > 0) return rows;
    return loadMasterByCode("ITEMCATEGORY");
  }
  if (family === "brand") {
    const rows = await searchCatalogFacet("GETBRAND", search);
    return rows.length > 0 ? rows : loadMasterByCode("BRAND");
  }
  if (family === "sku") return searchCatalogItems(search);
  if (family === "model") {
    const rows = await searchCatalogFacet("GETMODEL", search);
    return rows.length > 0 ? rows : loadMasterByCode("MODEL");
  }
  if (family === "source") return loadMasterByCode("LEADSOURCE");
  if (family === "sourcecategory") return loadMasterByCode("SOURCECATEGORY");
  if (family === "industry") return loadMasterByCode("INDUSTRY");
  if (family === "tag") return loadMasterByCode("TAG");
  if (family === "contacttype") return loadMasterByCode("CONTACTTYPE");
  if (family === "relationship") return loadMasterByCode("RELATIONSHIPTYPE");
  if (family === "referral") return loadMasterByCode("REFERRALSOURCE");
  if (family === "priority") return loadMasterByCode("PRIORITY");
  if (family === "asset") return loadMasterByCode("ASSET");
  if (family === "sla") return loadMasterByCode("SLA");
  if (family === "channel") return loadMasterByCode("CHANNEL");
  if (tab.Code) {
    const byCode = await loadMasterByCode(tab.Code);
    if (byCode.length > 0) return byCode;
  }
  return [];
}

function reportingDateFilter(intent: ReportIntent): ReturnType<typeof toLiveDateFilter> | Record<string, unknown> {
  if (!intent.date) return {};
  return toLiveDateFilter(intent.date);
}

async function loadReportingRows(
  method: string,
  reporting: ReportingFilterDetail,
  pageSize: number,
): Promise<{ rows: Record<string, unknown>[]; total: number; source: string } | null> {
  try {
    const envelope = await postReporting(method, {
      ...reporting,
      PageNumber: 0,
      PageSize: pageSize,
    });
    const data = envelope.Data ?? envelope;
    const rows = asRows(data);
    return {
      rows,
      total: asTotal(data, asTotal(envelope, rows.length)),
      source: `reporting ${method}`,
    };
  } catch {
    try {
      const envelope = await postReporting(method, {
        ...reporting,
        DateFilter: {},
        PageNumber: 0,
        PageSize: pageSize,
      });
      const data = envelope.Data ?? envelope;
      const rows = asRows(data);
      return {
        rows,
        total: asTotal(data, asTotal(envelope, rows.length)),
        source: `reporting ${method}`,
      };
    } catch {
      return null;
    }
  }
}

function followUps(entity: ReportEntity, intent: ReportIntent): string[] {
  return [
    intent.raw,
    `${entity.plural} created last 7 days`,
    `${entity.plural} I own this month`,
    `What filters can I use on ${entity.plural}?`,
  ].filter((row, index, all) => row && all.indexOf(row) === index);
}

async function loadManageList(
  entity: ReportEntity,
  listQuery: Parameters<typeof listManageRecords>[0],
): Promise<{ rows: Record<string, unknown>[]; total: number; source: string }> {
  try {
    const page = await listManageRecords(listQuery);
    if (page.rows.length > 0 || page.total > 0) {
      return {
        rows: page.rows as Record<string, unknown>[],
        total: page.total,
        source: `DYNAMIC AcGetData ${entity.listModule}`,
      };
    }
  } catch {
    // Wrapped MANAGE is the live fallback when unwrapped FilterValues 400.
  }
  try {
    const page = await listManageRecords({
      ...listQuery,
      module: entity.dynamicModule,
      action: "MANAGE",
      code: "MANAGE",
      primaryKey: "Id",
    });
    if (page.rows.length > 0 || page.total > 0) {
      return {
        rows: page.rows as Record<string, unknown>[],
        total: page.total,
        source: `DYNAMIC ${entity.dynamicModule} MANAGE`,
      };
    }
  } catch {
    // Unfiltered MANAGE still returns rows when FilterValues are rejected.
  }
  try {
    const page = await listManageRecords({
      ...listQuery,
      filterId: null,
      filterValues: null,
      module: entity.dynamicModule,
      action: "MANAGE",
      code: "MANAGE",
      primaryKey: "Id",
    });
    return {
      rows: page.rows as Record<string, unknown>[],
      total: page.total,
      source: `DYNAMIC ${entity.dynamicModule} MANAGE`,
    };
  } catch {
    const page = await listManageRecords({
      ...listQuery,
      filterId: null,
      filterValues: null,
      sortColumn: "createddate",
    });
    return {
      rows: page.rows as Record<string, unknown>[],
      total: page.total,
      source: `DYNAMIC AcGetData ${entity.listModule}`,
    };
  }
}

function buildReportingFilter(
  intent: ReportIntent,
  resolved: {
    ownerIds: string[];
    assigneeIds: string[];
    locationIds: string[];
    workflows: Array<{ id: string; stages: string[] }>;
    itemIds: string[];
    categoryIds: string[];
    brandIds: string[];
    skuIds: string[];
    modelIds: string[];
  },
): ReportingFilterDetail {
  return {
    FilterId: "",
    IsActive: true,
    FullTextSearch: intent.search || "",
    WorkflowFilters: resolved.workflows.map((workflow) => ({
      WorkflowId: workflow.id,
      Stages: workflow.stages,
    })),
    DateFilter: reportingDateFilter(intent),
    LocationFilter: {
      Sites: resolved.locationIds,
      Cities: [],
      Countries: [],
      Counties: [],
    },
    OwnerAssigneeFilter: {
      Owners: resolved.ownerIds,
      Assignees: resolved.assigneeIds,
    },
    Itemfilter: {
      Items: resolved.itemIds,
      Categories: resolved.categoryIds,
      Brands: resolved.brandIds,
      SKUs: resolved.skuIds,
      Models: resolved.modelIds,
    },
    MasterFilter: {},
    CustomFieldFilters: [],
    Apps: [],
  };
}

function rowId(row: Record<string, unknown>): string {
  const value = row.Id ?? row.id ?? row.QuoteId ?? row.LeadId ?? row.OrderId;
  return value == null ? "" : String(value);
}

function asRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["Data", "data", "Records", "myDashboardDataList", "QuoteDetail", "LeadDetail", "value", "Value"]) {
      const inner = asRows(obj[key]);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}

function asTotal(raw: unknown, fallback: number): number {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const total = Number(obj.TotalRecord ?? obj.TotalCount ?? obj.total ?? obj.Count);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  return fallback;
}

function chipsFor(intent: ReportIntent, extra: string[]): string[] {
  const chips: string[] = [];
  if (intent.entity) chips.push(REPORT_ENTITIES[intent.entity].plural);
  chips.push(
    intent.metric === "value"
      ? "value (sum)"
      : intent.stack === "dashboard"
        ? "dashboard"
        : intent.stack === "count"
          ? "count"
          : "list",
  );
  if (intent.workforceTopic) chips.push(intent.workforceTopic);
  if (intent.personName) chips.push(intent.personName);
  if (intent.ownerMe) chips.push("owned by me");
  if (intent.ownerName) chips.push(`owner ${intent.ownerName}`);
  if (intent.assigneeMe) chips.push("assigned to me");
  if (intent.assigneeName) chips.push(`assignee ${intent.assigneeName}`);
  for (const row of intent.criteria) {
    if (row.me) chips.push(`${row.key} me`);
    else if (row.values.length) chips.push(`${row.key} ${row.values.join(", ")}`);
  }
  if (intent.date) chips.push(modeLabel(intent.date));
  for (const stage of intent.stageNames) chips.push(stage);
  if (intent.search) chips.push(`search “${intent.search}”`);
  if (intent.savedFilterName) chips.push(`filter ${intent.savedFilterName}`);
  if (intent.useDefaultFilter) chips.push("default filter");
  chips.push(...extra);
  return chips;
}

function summaryText(
  entity: ReportEntity,
  intent: ReportIntent,
  total: number,
  amount: number,
  source: string,
  currencySymbol: string,
): string {
  const qualifier = chipsFor(intent, []).filter(
    (chip) => chip !== entity.plural && chip !== "list" && chip !== "count" && chip !== "value (sum)",
  );
  const tail = qualifier.length > 0 ? ` (${qualifier.join(" · ")})` : "";
  if (intent.metric === "value") {
    return `Value: ${formatAmount(amount, currencySymbol)} across ${total} ${total === 1 ? entity.title.toLowerCase() : entity.plural}${tail}. Source: ${source}.`;
  }
  const verb = intent.stack === "dashboard" ? "Dashboard" : intent.stack === "count" ? "Count" : "Report";
  return `${verb}: ${total} ${total === 1 ? entity.title.toLowerCase() : entity.plural}${tail}. Source: ${source}.`;
}

async function loadMappedCurrency(): Promise<Record<string, unknown> | null> {
  try {
    await listCurrencies();
  } catch {
    // Currency list cache is optional; SETTING / user currency still apply.
  }
  try {
    const option = await getSubscriberUserCurrency();
    if (!option) return null;
    return { ...(option.extra ?? {}), CurrencyId: option.id, Id: option.id, Label: option.label };
  } catch {
    return null;
  }
}

function enforceMappedCurrency(text: string, code: string, symbol: string): string {
  if (!text || !symbol) return text;
  if (code === "USD" || symbol === "$") return text;
  return text
    .replace(/USD\s*\$/gi, symbol)
    .replace(/\$\s*(?=\d)/g, `${symbol} `)
    .replace(/\bUSD\b/g, code || symbol)
    .replace(/\bUS dollars?\b/gi, code || "the mapped currency")
    .replace(/\bdollars?\b/gi, code || "the mapped currency");
}

function missingName(kind: string, needle: string, options: LookupOption[]): ReportResult {
  const sample = options.slice(0, 8).map((option) => option.label);
  return emptyResult({
    text: `I could not match ${kind} “${needle}”.${sample.length ? ` Known values include: ${sample.join(", ")}.` : ""}`,
    chips: [],
    total: 0,
    rows: [],
    columns: [],
    stack: "list",
    suggestions: sample.slice(0, 4).map((label) => `Try ${label}`),
    applied: { filterId: null, filterValues: null, fullTextSearch: "" },
  });
}

function clarifyEntity(pathEntity?: ReportEntity["key"]): ReportResult {
  return emptyResult({
    text: "Which records should I report on — quotes, leads, opportunities, orders, invoices, receipts, service tickets, work orders, actions, or workforce?",
    chips: [],
    total: 0,
    rows: [],
    columns: [],
    stack: "list",
        suggestions: [
          "What filters can I use on the dashboard?",
          "Team snapshot this month",
          "Quote snapshot owned by me last 7 days",
          "Find my team",
        ],
    applied: { filterId: null, filterValues: null, fullTextSearch: "" },
  });
}


function ensureDateFilter(values: FilterValueRow[] | null, intent: ReportIntent): FilterValueRow[] | null {
  const rows = (values ? [...values] : []).filter((row) => row.ControlType !== "DATE" && row.TabCode !== "DATE");
  if (!intent.date) return rows.length ? rows : null;
  rows.push({
    TabCode: "DATE",
    PropertyName: periodProperty(intent.date.fieldType),
    ControlType: "DATE",
    LabelName: "Created filter",
    DateFilter: toLiveDateFilter(intent.date),
  });
  return rows;
}

function refineRows(
  rows: Record<string, unknown>[],
  intent: ReportIntent,
  ownerIds: string[],
  meLabel: string,
): Record<string, unknown>[] {
  let next = rows;
  const window = intent.date ? dateWindow(intent.date) : null;
  if (window) {
    const field =
      intent.date?.fieldType === "UPDATEDFILTER" || intent.date?.fieldType === "NOTUPDATEDFILTER"
        ? "updated"
        : intent.date?.fieldType === "CLOSEDFILTER"
          ? "closed"
          : intent.date?.fieldType === "SCHEDULEFILTER"
            ? "scheduled"
            : intent.date?.fieldType === "DUEFILTER"
              ? "due"
              : "created";
    next = next.filter((row) => {
      const date = rowDate(row, field) || rowDate(row, "created") || rowDate(row, "updated");
      if (!date) return false;
      return date >= window.from && date <= window.to;
    });
  }
  if (ownerIds.length > 0 || (intent.ownerMe && meLabel)) {
    next = next.filter((row) => {
      const ownerId = String(row.OwnerId ?? row.ownerid ?? "");
      if (ownerId && ownerIds.includes(ownerId)) return true;
      if (meLabel && normalize(rowOwner(row)).includes(normalize(meLabel))) return true;
      return false;
    });
  }
  if (intent.stageNames.length > 0) {
    next = next.filter((row) => {
      const status = normalize(rowStatus(row));
      return intent.stageNames.some((name) => status.includes(normalize(name)));
    });
  }
  if (intent.search) {
    const needle = normalize(intent.search);
    next = next.filter((row) => normalize(`${rowTitle(row)} ${row.CompanyName ?? ""}`).includes(needle));
  }
  return next;
}

async function genAiAnalysis(
  question: string,
  summary: ReturnType<typeof buildDatasetSummary>,
  history: ChatHistoryTurn[] = [],
): Promise<string> {
  try {
    const res = await fetch("/api/ask/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, summary, history: history.slice(-8) }),
    });
    const json = (await res.json()) as { analysis?: string; hint?: string; error?: string };
    if (json.analysis) return enforceMappedCurrency(json.analysis, summary.currencyCode, summary.currencySymbol);
    const local = localAnalysis(question, summary);
    if (json.hint) return `${local}\n\n${json.hint}`;
    return local;
  } catch {
    return localAnalysis(question, summary);
  }
}

export async function runReportQuestion(
  question: string,
  previous: ReportIntent | null,
  user: TebUserDetail | null,
  pathEntity?: ReportEntity["key"],
  history: ChatHistoryTurn[] = [],
): Promise<{ intent: ReportIntent | null; result: ReportResult }> {
  const trimmed = question.trim();
  if (isGreeting(trimmed)) {
    return {
      intent: previous,
      result: emptyResult({
        text: HELP_TEXT,
        chips: [],
        total: 0,
        rows: [],
        columns: [],
        stack: "list",
        suggestions: [
          "Team snapshot this month",
          "Quote snapshot owned by me last 7 days",
          "Find my team",
          "Leads I own this month",
        ],
        applied: { filterId: null, filterValues: null, fullTextSearch: "" },
      }),
    };
  }

  const intent = parseQuestion(trimmed, previous, pathEntity);
  if (intent.listFilters && (intent.stack === "dashboard" || isDashboardQuestion(trimmed))) {
    return { intent, result: dashboardHelpResult(emptyResult) };
  }
  if (!intent.entity) {
    if (intent.stack === "dashboard" || isDashboardQuestion(trimmed)) {
      const people = await resolveDashboardOwners(intent, user);
      if ("error" in people) {
        return {
          intent,
          result: emptyResult({
            text: `I could not match owner “${people.error}”.${people.options.length ? ` Known values include: ${people.options.join(", ")}.` : ""}`,
            chips: ["dashboard"],
            total: 0,
            rows: [],
            columns: DASHBOARD_COLUMNS,
            stack: "dashboard",
            suggestions: DASHBOARD_SUGGESTIONS,
            applied: { filterId: null, filterValues: null, fullTextSearch: "" },
          }),
        };
      }
      const filter = buildDashboardFilter(intent, {
        ownerIds: people.ownerIds,
        assigneeIds: people.assigneeIds,
        locationIds: [],
        workflows: [],
      });
      try {
        const snapshot = await fetchTeamSnapshot(filter);
        const charts = dashboardCharts(snapshot.rows);
        return {
          intent,
          result: {
            text: snapshot.rows.length
              ? `Team snapshot: ${snapshot.total} records across ${snapshot.rows.length} modules. Source: ${snapshot.source}.`
              : `Team snapshot returned no module counts. Source: ${snapshot.source}.`,
            analysis: snapshot.rows
              .slice(0, 12)
              .map((row) => `${row.Title}: ${Number(row.Count ?? 0).toLocaleString()}`)
              .join("\n"),
            chips: chipsFor(intent, people.extraChips),
            total: snapshot.total,
            amount: 0,
            metric: "count",
            currencySymbol: "",
            currencyCode: "",
            rows: snapshot.rows,
            columns: DASHBOARD_COLUMNS,
            charts,
            entity: undefined,
            stack: "dashboard",
            suggestions: DASHBOARD_SUGGESTIONS,
            applied: { filterId: null, filterValues: null, fullTextSearch: intent.search || "" },
          },
        };
      } catch (err) {
        const message = err instanceof TebApiError ? err.message : "The dashboard reporting APIs did not return a snapshot.";
        return {
          intent,
          result: emptyResult({
            text: message,
            chips: chipsFor(intent, people.extraChips),
            total: 0,
            rows: [],
            columns: DASHBOARD_COLUMNS,
            stack: "dashboard",
            suggestions: DASHBOARD_SUGGESTIONS,
            applied: { filterId: null, filterValues: null, fullTextSearch: "" },
          }),
        };
      }
    }
    return { intent, result: clarifyEntity(pathEntity) };
  }

  const entity = REPORT_ENTITIES[intent.entity];
  if (entity.key === "workforce") {
    return { intent, result: await runWorkforceReport(intent, emptyResult) };
  }
  if (intent.listFilters) {
    const screen = await loadScreen(entity.dynamicModule);
    const lines = screen.Tabs.map((tab) => {
      const type = String(tab.TabViewType || tab.CustomControlType || "MULTISELECT");
      return `• ${tab.Title || tab.Code} (${tab.Code}, ${type})`;
    });
    return {
      intent,
      result: emptyResult({
        text:
          lines.length > 0
            ? `${entity.title} Manage filters from GetFilterControls:\n${lines.join("\n")}\n\nCombine them like: ${entity.plural} where owner = Akash, Priya and status = Open created last 7 days`
            : `No filter tabs were returned for ${entity.plural}. I can still apply owner, assignee, status, and date from your question.`,
        chips: [entity.plural, "filter fields"],
        total: 0,
        rows: [],
        columns: entity.columns,
        entity: entity.key,
        stack: "list",
        suggestions: screen.Tabs.flatMap((tab) => tabPhrases(tab)).slice(0, 6),
        applied: { filterId: null, filterValues: null, fullTextSearch: "" },
      }),
    };
  }
  const me = ownerFromUser(user);
  const extraChips: string[] = [];

  let filterId: string | null = null;
  let filterValues: FilterValueRow[] | null = null;
  const search = intent.search || "";

  if (intent.useDefaultFilter || intent.savedFilterName) {
    const saved = await listSavedFilters(entity.dynamicModule);
    if (intent.useDefaultFilter) {
      const fallback = saved.find((row) => Boolean(row.extra?.IsDefault)) || saved[0];
      if (!fallback) {
        return {
          intent,
          result: emptyResult({
            text: `No saved Manage filters were returned for ${entity.plural}. I can still apply owner, date, and stage filters from your question.`,
            chips: chipsFor(intent, []),
            total: 0,
            rows: [],
            columns: entity.columns,
            entity: entity.key,
            stack: intent.stack,
            suggestions: [`${entity.plural} created in the last 7 days`],
            applied: { filterId: null, filterValues: null, fullTextSearch: "" },
          }),
        };
      }
      filterId = fallback.id;
      extraChips.push(fallback.label);
    } else if (intent.savedFilterName) {
      const matches = matchLookups(saved, intent.savedFilterName);
      const picked = pickBest(matches, intent.savedFilterName);
      if (!picked) return { intent, result: missingName("saved filter", intent.savedFilterName, saved) };
      filterId = picked.id;
      extraChips.push(picked.label);
    }
  }

  const needsAdHoc =
    !filterId &&
    (intent.criteria.length > 0 ||
      intent.ownerMe ||
      Boolean(intent.ownerName) ||
      intent.assigneeMe ||
      Boolean(intent.assigneeName) ||
      Boolean(intent.date) ||
      intent.stageNames.length > 0 ||
      Boolean(intent.workflowName) ||
      Boolean(intent.locationName));

  const ownerIds: string[] = [];
  const assigneeIds: string[] = [];
  const locationIds: string[] = [];
  const statusIds: string[] = [];
  const workflows: Array<{ id: string; stages: string[] }> = [];
  const extras: Array<{ tab: FilterTab; ids: string[] }> = [];
  const itemIds: string[] = [];
  const categoryIds: string[] = [];
  const brandIds: string[] = [];
  const skuIds: string[] = [];
  const modelIds: string[] = [];

  if (needsAdHoc) {
    const screen = await loadScreen(entity.dynamicModule);
    const tabs = screen.Tabs;
    const peopleNeeded = intent.criteria.some((row) => /^(owner|assignee)$/.test(aliasFamily(row.key))) ||
      intent.ownerMe ||
      Boolean(intent.ownerName) ||
      intent.assigneeMe ||
      Boolean(intent.assigneeName);
    const stageNeeded =
      intent.criteria.some((row) => /^(status|workflow)$/.test(aliasFamily(row.key))) ||
      intent.stageNames.length > 0 ||
      Boolean(intent.workflowName);
    const [owners, workflowOptions] = await Promise.all([
      peopleNeeded ? listOwners() : Promise.resolve([]),
      stageNeeded ? listWorkflowsForModule(entity.workflowModules) : Promise.resolve([]),
    ]);

    async function resolveNames(kind: string, names: string[], options: LookupOption[]): Promise<string[] | ReportResult> {
      const ids: string[] = [];
      for (const name of names) {
        const picked = pickBest(matchLookups(options, name), name);
        if (!picked) return missingName(kind, name, options);
        ids.push(picked.id);
        extraChips.push(picked.label);
      }
      return ids;
    }

    for (const row of intent.criteria) {
      const family = aliasFamily(row.key);
      if (family === "owner") {
        if (row.me && me) ownerIds.push(me.id);
        if (row.values.length > 0) {
          const ids = await resolveNames("owner", row.values, owners);
          if (!Array.isArray(ids)) return { intent, result: ids };
          ownerIds.push(...ids);
        }
        continue;
      }
      if (family === "assignee") {
        if (row.me && me) assigneeIds.push(me.id);
        if (row.values.length > 0) {
          const ids = await resolveNames("assignee", row.values, owners);
          if (!Array.isArray(ids)) return { intent, result: ids };
          assigneeIds.push(...ids);
        }
        continue;
      }
      if (family === "workflow") {
        if (row.values[0]) {
          const picked = pickBest(matchLookups(workflowOptions, row.values[0]), row.values[0]);
          if (!picked) return { intent, result: missingName("workflow", row.values[0], workflowOptions) };
          workflows.push({ id: picked.id, stages: [] });
          extraChips.push(picked.label);
        }
        continue;
      }
      if (family === "status") {
        const limited = (workflows.length > 0
          ? workflowOptions.filter((option) => workflows.some((item) => item.id === option.id))
          : workflowOptions
        ).slice(0, 8);
        const pool = limited.length > 0 ? limited : workflowOptions.slice(0, 8);
        const stageLists = await Promise.all(pool.map((workflow) => listWorkflowStages(workflow.id, entity.listModule)));
        for (let index = 0; index < pool.length; index += 1) {
          const matchedIds: string[] = [];
          for (const name of row.values) {
            const picked = pickBest(matchLookups(stageLists[index] ?? [], name), name);
            if (picked) matchedIds.push(picked.id);
          }
          if (matchedIds.length > 0) {
            const existing = workflows.find((item) => item.id === pool[index].id);
            if (existing) existing.stages = [...new Set([...existing.stages, ...matchedIds])];
            else workflows.push({ id: pool[index].id, stages: matchedIds });
            statusIds.push(...matchedIds);
          }
        }
        if (row.values.length > 0 && statusIds.length === 0) {
          return { intent, result: missingName("status", row.values.join(", "), stageLists.flat().slice(0, 8)) };
        }
        continue;
      }

      const catalog = ["item", "category", "brand", "sku", "model", "type", "currency", "contact", "priority", "related", "asset", "sla", "channel"].includes(family);
      const literal = ["quotecode", "ordercode", "invoicecode", "validfor", "title", "ticketcode", "workordercode"].includes(family);
      const tab = matchTab(tabs, row.key) || (catalog || literal ? matchTab(fallbackFilterTabs(), row.key) : null);
      if (!tab) {
        return {
          intent,
          result: missingName(
            row.key,
            row.values.join(", ") || row.key,
            tabs.map((item) => ({ id: item.Code, label: item.Title || item.Code })),
          ),
        };
      }
      const ids: string[] = [];
      for (const name of row.values) {
        const options = await loadTabOptions(screen, tab, entity, name);
        const picked = pickBest(matchLookups(options, name), name);
        if (!picked) {
          if (literal) {
            ids.push(name);
            extraChips.push(name);
            continue;
          }
          return { intent, result: missingName(tab.Title || row.key, name, options) };
        }
        ids.push(picked.id);
        extraChips.push(picked.label);
      }
      extras.push({ tab, ids });
      if (family === "location") locationIds.push(...ids);
      if (family === "item") itemIds.push(...ids);
      if (family === "category") categoryIds.push(...ids);
      if (family === "brand") brandIds.push(...ids);
      if (family === "sku") skuIds.push(...ids);
      if (family === "model") modelIds.push(...ids);
    }

    if (intent.ownerMe && me && !ownerIds.includes(me.id)) ownerIds.push(me.id);
    if (intent.assigneeMe && me && !assigneeIds.includes(me.id)) assigneeIds.push(me.id);

    filterValues = ensureDateFilter(
      buildFilterValues(tabs, intent, {
        ownerIds,
        assigneeIds,
        locationIds,
        statusIds,
        workflows,
        extras,
      }),
      intent,
    );
  }

  const reportingPayload = buildDashboardFilter(intent, {
    ownerIds,
    assigneeIds,
    locationIds,
    workflows,
    itemIds,
    categoryIds,
    brandIds,
    skuIds,
    modelIds,
  });

  const listQuery = {
    module: entity.listModule,
    filterId,
    filterValues,
    fullTextSearch: search,
    pageNumber: 0,
    pageSize: Math.max(intent.pageSize, 100),
    sortColumn: "modifieddate",
    sortOrder: true,
  };

  let rows: Record<string, unknown>[] = [];
  let total = 0;
  let source = `DYNAMIC AcGetData ${entity.listModule}`;

  if (intent.stack === "dashboard" || intent.stack === "count") {
    try {
      const dash = await fetchEntityDashboard(entity, reportingPayload, intent.pageSize);
      rows = dash.rows;
      total = dash.total;
      source = dash.source;
    } catch (err) {
      if (intent.stack === "dashboard") {
        const message = err instanceof TebApiError ? err.message : "The dashboard reporting APIs did not return a snapshot.";
        return {
          intent,
          result: emptyResult({
            text: message,
            chips: chipsFor(intent, extraChips),
            total: 0,
            rows: [],
            columns: entity.columns,
            entity: entity.key,
            stack: intent.stack,
            suggestions: DASHBOARD_SUGGESTIONS,
            applied: { filterId, filterValues, fullTextSearch: search },
          }),
        };
      }
    }
  }

  if (rows.length === 0 && intent.stack !== "dashboard") {
    try {
      const page = await loadManageList(entity, listQuery);
      rows = page.rows;
      total = page.total;
      source = page.source;
    } catch (err) {
      if (!entity.reportingMethod) {
        const message = err instanceof TebApiError ? err.message : "The filter APIs did not return a report.";
        return {
          intent,
          result: emptyResult({
            text: message,
            chips: chipsFor(intent, extraChips),
            total: 0,
            rows: [],
            columns: entity.columns,
            entity: entity.key,
            stack: intent.stack,
            suggestions: followUps(entity, intent),
            applied: { filterId, filterValues, fullTextSearch: search },
          }),
        };
      }
    }
    if (rows.length === 0 && entity.reportingMethod) {
      const reporting = buildReportingFilter(intent, {
        ownerIds,
        assigneeIds,
        locationIds,
        workflows,
        itemIds,
        categoryIds,
        brandIds,
        skuIds,
        modelIds,
      });
      const loaded = await loadReportingRows(entity.reportingMethod, reporting, intent.pageSize);
      if (loaded && (loaded.rows.length > 0 || loaded.total > 0)) {
        rows = loaded.rows;
        total = loaded.total;
        source = loaded.source;
      } else if (rows.length === 0 && total === 0 && !loaded) {
        return {
          intent,
          result: emptyResult({
            text: "The list and reporting APIs did not return rows for those filters.",
            chips: chipsFor(intent, extraChips),
            total: 0,
            rows: [],
            columns: entity.columns,
            entity: entity.key,
            stack: intent.stack,
            suggestions: followUps(entity, intent),
            applied: { filterId, filterValues, fullTextSearch: search },
          }),
        };
      }
    }
  }

  if (intent.stack === "count" && intent.metric !== "value" && total === rows.length) {
    const reportingMethod = entity.reportingMethod;
    if (reportingMethod) {
    const reporting = buildReportingFilter(intent, {
        ownerIds,
        assigneeIds,
        locationIds,
        workflows,
        itemIds,
        categoryIds,
        brandIds,
        skuIds,
        modelIds,
      });
    try {
      const envelope = await postReporting(reportingMethod, {
        ...reporting,
        PageNumber: 0,
        PageSize: 1,
      });
      const data = envelope.Data ?? envelope;
      const reported = asTotal(data, asTotal(envelope, total));
      if (reported > total) {
        total = reported;
        source = `reporting ${reportingMethod}`;
      }
    } catch {
      // List total is enough.
    }
    }
  }

  const meLabel = me?.label || "";
  const snapshot = intent.stack === "dashboard" && looksLikeSnapshot(rows);
  if (!snapshot) {
    const refined = refineRows(rows, intent, ownerIds, meLabel);
    if (refined.length !== rows.length) {
      rows = refined;
      total = refined.length;
      extraChips.push("narrowed to matching rows");
    }
  }
  if (rows.length === 0 && entity.reportingMethod && intent.stack !== "dashboard") {
    const reporting = buildReportingFilter(intent, {
      ownerIds,
      assigneeIds,
      locationIds,
      workflows,
      itemIds,
      categoryIds,
      brandIds,
      skuIds,
      modelIds,
    });
    const loaded = await loadReportingRows(entity.reportingMethod, reporting, intent.pageSize);
    if (loaded && (loaded.rows.length > 0 || loaded.total > 0)) {
      rows = loaded.rows;
      total = loaded.total;
      source = loaded.source;
    }
  }

  const preferredCurrency = await loadMappedCurrency();
  const summary = buildDatasetSummary(rows, total, intent.metric, preferredCurrency, entity.key === "receipt");
  const charts = snapshot ? dashboardCharts(rows) : pickCharts(intent, summary);
  const analysis =
    rows.length > 0
      ? snapshot
        ? rows
            .slice(0, 12)
            .map((row) => `${row.Title}: ${Number(row.Count ?? 0).toLocaleString()}`)
            .join("\n")
        : await genAiAnalysis(intent.raw, summary, history)
      : intent.stack === "dashboard"
        ? "No dashboard snapshot rows were returned for those FilterDetail criteria."
        : "No rows matched those Manage filter criteria.";

  return {
    intent,
    result: {
      text: summaryText(entity, intent, total, summary.amount, source, summary.currencySymbol),
      analysis,
      chips: chipsFor(intent, extraChips),
      total,
      amount: summary.amount,
      metric: intent.metric,
      currencySymbol: summary.currencySymbol,
      currencyCode: summary.currencyCode,
      rows,
      columns: entity.columns,
      charts,
      summary,
      entity: entity.key,
      stack: intent.stack,
      viewHref: entity.viewPath
        ? (row) => {
            const id = rowId(row);
            return id ? entity.viewPath!(id) : null;
          }
        : undefined,
      suggestions:
        intent.stack === "dashboard"
          ? DASHBOARD_SUGGESTIONS
          : [
              `${entity.plural} created in the last 7 days`,
              `Pie chart of ${entity.plural} this month`,
              `${entity.title} trend this quarter`,
            ],
      applied: { filterId, filterValues, fullTextSearch: search },
    },
  };
}
