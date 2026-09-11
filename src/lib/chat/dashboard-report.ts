import { postReporting } from "@/lib/api/filters";
import { ownerFromUser, listOwners } from "@/lib/api/quote-lookups";
import type { TebUserDetail } from "@/lib/api/types";
import type { ReportEntity } from "@/lib/chat/entities";
import type {
  ChartSeries,
  ReportColumn,
  ReportIntent,
  ReportResult,
  ReportingFilterDetail,
} from "@/lib/chat/types";
import { toLiveDateFilter } from "@/lib/chat/date-filter";
import { friendlyModuleLabel } from "@/lib/chat/user-copy";

export const DASHBOARD_FILTER_HELP =
  "You can ask about the Management Dashboard in plain language.\n\nMention filters such as:\n• Date — created, updated, closed, or scheduled; last N days or between dates\n• Owner\n• Assignee\n• Workflow or stages\n• Location\n• Items, category, brand, SKU, or model\n• A saved filter by name\n\nExamples:\n• Team snapshot this month\n• Quote snapshot owned by me last 7 days\n• How many leads in Open";

export const DASHBOARD_SUGGESTIONS = [
  "Team snapshot this month",
  "Quote snapshot owned by me last 7 days",
  "What filters can I use on the dashboard?",
  "How many leads in Open",
];

export const DASHBOARD_COLUMNS: ReportColumn[] = [
  { key: "Title", title: "Module" },
  { key: "Count", title: "Count" },
  { key: "Status", title: "Status" },
  { key: "OwnerName", title: "Owner" },
];

const SNAPSHOT_CHART: Partial<Record<ReportEntity["key"], string>> = {
  lead: "LEADSNAPSHOT",
  opportunity: "OPPORTUNITYSNAPSHOT",
  quote: "QUOTESNAPSHOT",
  order: "ORDERSNAPSHOT",
  invoice: "INVOICESNAPSHOT",
  receipt: "INVOICESNAPSHOT",
  workorder: "WORKORDERSNAPSHOT",
  action: "ACTIONSNAPSHOT",
};

function unwrap(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw === "string") {
    try {
      return unwrap(JSON.parse(raw));
    } catch {
      return raw;
    }
  }
  return raw;
}

function asRows(raw: unknown): Record<string, unknown>[] {
  const parsed = unwrap(raw);
  if (Array.isArray(parsed)) {
    return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of [
      "Data",
      "data",
      "Records",
      "ChartData",
      "ChartListData",
      "myDashboardDataList",
      "Modules",
      "value",
      "Value",
    ]) {
      const inner = asRows(obj[key]);
      if (inner.length > 0) return inner;
    }
    const numeric = Object.entries(obj).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
    if (numeric.length >= 2 && numeric.length <= 20) {
      return numeric.map(([title, value]) => ({ Title: title, Count: value, Status: title }));
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

function flattenTeamSnapshot(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byApp = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const apps = Array.isArray(row.AppWiseCount) ? row.AppWiseCount : [];
    for (const app of apps) {
      if (!app || typeof app !== "object") continue;
      const rec = app as Record<string, unknown>;
      const key = String(rec.AppId ?? rec.AppName ?? "");
      if (!key) continue;
      const label = friendlyModuleLabel(rec.AppName ?? rec.AppId ?? key);
      const prev = byApp.get(key) ?? {
        Title: label,
        Module: key,
        Count: 0,
        TotalCount: 0,
        TotalValue: 0,
        CurrencyIcon: rec.CurrencyIcon ?? row.CurrencyIcon ?? "",
        Status: label,
      };
      const count = Number(rec.TotalCount ?? rec.Count ?? 0) || 0;
      const value = Number(rec.TotalValue ?? 0) || 0;
      prev.Count = Number(prev.Count ?? 0) + count;
      prev.TotalCount = Number(prev.TotalCount ?? 0) + count;
      prev.TotalValue = Number(prev.TotalValue ?? 0) + value;
      byApp.set(key, prev);
    }
  }
  return byApp.size > 0 ? [...byApp.values()] : rows;
}

export function normalizeDashboardRows(raw: unknown): Record<string, unknown>[] {
  const rows = flattenTeamSnapshot(asRows(raw));
  return rows.map((row) => {
    const title = friendlyModuleLabel(
      row.Title ?? row.AppName ?? row.TeamName ?? row.Name ?? row.Module ?? row.ModuleCode ?? row.Text ?? row.Label ?? "Module",
    );
    const count = Number(
      row.Count ?? row.TotalCount ?? row.TotalRecord ?? row.RecordCount ?? row.Value ?? row.Total ?? 0,
    );
    return {
      ...row,
      Title: title,
      Count: Number.isFinite(count) ? count : 0,
      Status: String(row.Status ?? row.Stage ?? title),
      OwnerName: String(row.OwnerName ?? row.MemberName ?? row.TeamName ?? ""),
    };
  });
}

export function looksLikeSnapshot(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0 || rows.length > 24) return false;
  return rows.every(
    (row) =>
      row.Count != null ||
      row.TotalCount != null ||
      row.AppWiseCount != null ||
      row.ModuleCode != null ||
      row.ChartCode != null ||
      row.RecordCount != null,
  );
}

export function dashboardCharts(rows: Record<string, unknown>[]): ChartSeries[] {
  const points = rows
    .map((row) => ({
      label: friendlyModuleLabel(row.Title ?? row.Status ?? "Module"),
      value: Number(row.Count ?? row.TotalCount ?? row.TotalRecord ?? 0),
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  if (points.length === 0) return [];
  return [{ kind: "bar", title: "Dashboard snapshot", points }];
}

export function buildDashboardFilter(
  intent: ReportIntent,
  resolved: {
    ownerIds: string[];
    assigneeIds: string[];
    locationIds: string[];
    workflows: Array<{ id: string; stages: string[] }>;
    itemIds?: string[];
    categoryIds?: string[];
    brandIds?: string[];
    skuIds?: string[];
    modelIds?: string[];
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
    DateFilter: intent.date ? toLiveDateFilter(intent.date) : {},
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
      Items: resolved.itemIds ?? [],
      Categories: resolved.categoryIds ?? [],
      Brands: resolved.brandIds ?? [],
      SKUs: resolved.skuIds ?? [],
      Models: resolved.modelIds ?? [],
    },
    MasterFilter: {},
    CustomFieldFilters: [],
    Apps: [],
  };
}

export async function fetchTeamSnapshot(
  filter: ReportingFilterDetail,
): Promise<{ rows: Record<string, unknown>[]; total: number; source: string }> {
  const envelope = await postReporting("GetTeamBasedRecordsCount", {
    ...filter,
    PageNumber: 0,
    PageSize: 50,
  });
  const data = envelope.Data ?? envelope;
  const rows = normalizeDashboardRows(data);
  const counted = rows.reduce((sum, row) => sum + Number(row.Count ?? 0), 0);
  return {
    rows,
    total: counted || asTotal(data, asTotal(envelope, rows.length)),
    source: "reporting GetTeamBasedRecordsCount",
  };
}

export async function fetchEntityDashboard(
  entity: ReportEntity,
  filter: ReportingFilterDetail,
  pageSize: number,
): Promise<{ rows: Record<string, unknown>[]; total: number; source: string }> {
  const chart = SNAPSHOT_CHART[entity.key];
  if (chart) {
    try {
      const envelope = await postReporting("GetModuleWiseOverviewDashboard", {
        ...filter,
        Module: entity.listModule,
        ModuleCode: entity.listModule,
        ChartCode: chart,
        PageNumber: 0,
        PageSize: pageSize,
      });
      const data = envelope.Data ?? envelope;
      const rows = normalizeDashboardRows(data);
      const total = asTotal(data, asTotal(envelope, rows.length));
      if (rows.length > 0 || total > 0) {
        return { rows, total, source: `reporting GetModuleWiseOverviewDashboard ${chart}` };
      }
    } catch {
      // Module details reporting is the live fallback.
    }
  }
  if (!entity.reportingMethod) return { rows: [], total: 0, source: "reporting" };
  const envelope = await postReporting(entity.reportingMethod, {
    ...filter,
    PageNumber: 0,
    PageSize: pageSize,
  });
  const data = envelope.Data ?? envelope;
  const rows = normalizeDashboardRows(data);
  return {
    rows,
    total: asTotal(data, asTotal(envelope, rows.length)),
    source: `reporting ${entity.reportingMethod}`,
  };
}

export async function resolveDashboardOwners(
  intent: ReportIntent,
  user: TebUserDetail | null,
): Promise<{ ownerIds: string[]; assigneeIds: string[]; extraChips: string[] } | { error: string; options: string[] }> {
  const me = ownerFromUser(user);
  const ownerIds: string[] = [];
  const assigneeIds: string[] = [];
  const extraChips: string[] = [];
  const names = [
    ...intent.criteria.filter((row) => row.key === "owner").flatMap((row) => row.values),
    ...(intent.ownerName ? [intent.ownerName] : []),
  ];
  const assigneeNames = [
    ...intent.criteria.filter((row) => row.key === "assignee").flatMap((row) => row.values),
    ...(intent.assigneeName ? [intent.assigneeName] : []),
  ];
  if (intent.ownerMe && me) ownerIds.push(me.id);
  if (intent.assigneeMe && me) assigneeIds.push(me.id);
  if (names.length === 0 && assigneeNames.length === 0) return { ownerIds, assigneeIds, extraChips };
  const owners = await listOwners();
  const want = (needle: string) => {
    const exact = owners.filter((row) => row.label.toLowerCase() === needle.toLowerCase() || row.id === needle);
    if (exact.length === 1) return exact[0];
    const contains = owners.filter((row) => row.label.toLowerCase().includes(needle.toLowerCase()));
    return contains[0] ?? exact[0] ?? null;
  };
  for (const name of names) {
    const picked = want(name);
    if (!picked) return { error: name, options: owners.slice(0, 8).map((row) => row.label) };
    ownerIds.push(picked.id);
    extraChips.push(picked.label);
  }
  for (const name of assigneeNames) {
    const picked = want(name);
    if (!picked) return { error: name, options: owners.slice(0, 8).map((row) => row.label) };
    assigneeIds.push(picked.id);
    extraChips.push(picked.label);
  }
  return { ownerIds, assigneeIds, extraChips };
}

export function dashboardHelpResult(
  emptyResult: (partial: Omit<ReportResult, "analysis" | "charts" | "amount" | "metric" | "currencySymbol" | "currencyCode">) => ReportResult,
): ReportResult {
  return emptyResult({
    text: DASHBOARD_FILTER_HELP,
    chips: ["dashboard"],
    total: 0,
    rows: [],
    columns: DASHBOARD_COLUMNS,
    stack: "dashboard",
    suggestions: DASHBOARD_SUGGESTIONS,
    applied: { filterId: null, filterValues: null, fullTextSearch: "" },
  });
}
