import type { ChartSeries, DatasetSummary, ReportIntent } from "@/lib/chat/types";
import { formatAmount, mappedCurrency } from "@/lib/money";
import { formatFriendlyDate, parseApiDate } from "@/lib/format-date";

function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null || value === "") continue;
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const nested = obj.Text ?? obj.Name ?? obj.Title ?? obj.Value;
      if (nested != null && String(nested).trim()) return String(nested).trim();
      continue;
    }
    const text = String(value).trim();
    if (text && text !== "[object Object]") return text;
  }
  const wanted = keys.map((key) => key.toLowerCase());
  for (const [key, value] of Object.entries(row)) {
    if (!wanted.includes(key.toLowerCase()) || value == null || value === "") continue;
    return String(value);
  }
  return "";
}

export function rowTitle(row: Record<string, unknown>): string {
  return (
    firstString(row, [
      "FullName",
      "CompanyName",
      "QuoteTitle",
      "TicketTitle",
      "WorkOrderTitle",
      "Title",
      "Name",
      "QuoteCode",
      "TicketCode",
      "WorkOrderCode",
      "OrderCode",
      "InvoiceCode",
      "ReceiptCode",
    ]) || "Untitled"
  );
}

export function rowOwner(row: Record<string, unknown>): string {
  return firstString(row, ["OwnerName", "Owner", "CreatedBy"]) || "Unassigned";
}

export function rowStatus(row: Record<string, unknown>): string {
  return (
    firstString(row, [
      "Status",
      "StatusName",
      "WorkFlowStatus",
      "WorkflowStatus",
      "WorkFlowStatusName",
      "Stage",
      "StageName",
      "WorkFlow",
      "Workflow",
      "Address",
      "Location",
    ]) || "Unknown"
  );
}

export function rowDate(
  row: Record<string, unknown>,
  field: "created" | "updated" | "closed" | "scheduled" | "due" = "created",
): Date | null {
  const keys =
    field === "updated"
      ? ["ModifiedDate", "UpdatedDate", "modifieddate"]
      : field === "closed"
        ? ["ClosedDate", "CloseDate", "EndDate"]
        : field === "scheduled"
          ? ["ScheduledDate", "ScheduleDate", "scheduledate", "StartDate"]
          : field === "due"
            ? ["DueDate", "duedate", "EndDate"]
            : ["CreatedDate", "StartDate", "DateOfJoining", "JoiningDate", "createddate"];
  const raw = firstString(row, keys);
  if (!raw) return null;
  return parseApiDate(raw);
}

function numericAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const nested of [
      "QuoteCurrentValue",
      "QuoteNetValue",
      "QuoteValue",
      "TotalAmount",
      "GrandTotal",
      "NetAmount",
      "Amount",
      "Value",
      "Total",
    ]) {
      const numeric = Number(obj[nested]);
      if (Number.isFinite(numeric) && numeric !== 0) return numeric;
    }
    return null;
  }
  const numeric = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export function rowAmount(row: Record<string, unknown>, preferReceived = false): number {
  const keys = [
    ...(preferReceived ? ["AmountReceived", "ReceivedAmount", "PaidAmount"] : []),
    "QuoteCurrentValue",
    "QuoteNetValue",
    "QuoteValue",
    "InvoiceValue",
    "OrderValue",
    "TotalAmount",
    "GrandTotal",
    "NetAmount",
    "QuoteTotal",
    "Total",
    "Amount",
    "Value",
    "totalamount",
    "grandtotal",
    "netamount",
    ...(!preferReceived ? ["AmountReceived", "ReceivedAmount", "PaidAmount"] : []),
  ];
  let zero = 0;
  for (const key of keys) {
    const raw = row[key] ?? Object.entries(row).find(([entry]) => entry.toLowerCase() === key.toLowerCase())?.[1];
    const numeric = numericAmount(raw);
    if (numeric == null) continue;
    if (numeric !== 0) return numeric;
    zero = 0;
  }
  return zero;
}

function topSums(
  rows: Record<string, unknown>[],
  labelOf: (row: Record<string, unknown>) => string,
  metric: "count" | "value",
  limit = 8,
  preferReceived = false,
): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = labelOf(row);
    const add = metric === "value" ? rowAmount(row, preferReceived) : 1;
    map.set(label, (map.get(label) || 0) + add);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_AXIS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"] as const;

/** Axis labels like `Jul 26` / `Sept 26` — not `07` or `2026-07`. */
export function formatMonthAxisLabel(label: string): string {
  const iso = label.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return `${MONTH_AXIS[month - 1]} ${iso[1].slice(-2)}`;
  }
  const monthOnly = label.trim().match(/^(\d{1,2})$/);
  if (monthOnly) {
    const month = Number(monthOnly[1]);
    if (month >= 1 && month <= 12) return MONTH_AXIS[month - 1];
  }
  return label;
}

export function buildDatasetSummary(
  rows: Record<string, unknown>[],
  total: number,
  metric: "count" | "value" = "count",
  preferredCurrency?: Record<string, unknown> | null,
  preferReceived = false,
): DatasetSummary {
  const byMonthMap = new Map<string, number>();
  for (const row of rows) {
    const date = rowDate(row) || rowDate(row, "updated");
    if (!date) continue;
    const key = monthKey(date);
    byMonthMap.set(key, (byMonthMap.get(key) || 0) + (metric === "value" ? rowAmount(row, preferReceived) : 1));
  }
  const byMonth = [...byMonthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ label: formatMonthAxisLabel(key), value }));
  const { symbol, code } = mappedCurrency(rows[0] ?? null, preferredCurrency);
  const amount = rows.reduce((sum, row) => sum + rowAmount(row, preferReceived), 0);

  return {
    total,
    shown: rows.length,
    amount,
    metric,
    currencySymbol: symbol,
    currencyCode: code,
    byStatus: topSums(rows, rowStatus, metric, 8, preferReceived),
    byOwner: topSums(rows, rowOwner, metric, 8, preferReceived),
    byMonth,
    dateField: "created",
    sample: rows.slice(0, 8).map((row) => {
      const date = rowDate(row);
      const rowAmt = rowAmount(row, preferReceived);
      return {
        title: rowTitle(row),
        owner: rowOwner(row),
        status: rowStatus(row),
        amount: rowAmt,
        amountFormatted: formatAmount(rowAmt, symbol),
        date: date
          ? formatFriendlyDate(
              `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            )
          : "",
      };
    }),
  };
}

export function pickCharts(intent: ReportIntent, summary: DatasetSummary): ChartSeries[] {
  const preferred = intent.chart;
  const value = intent.metric === "value";
  const charts: ChartSeries[] = [];
  const status = { kind: "pie" as const, title: value ? "Value by status" : "By status", points: summary.byStatus };
  const owner = { kind: "bar" as const, title: value ? "Value by owner" : "By owner", points: summary.byOwner };
  const trend = { kind: "line" as const, title: value ? "Value by month" : "Created by month", points: summary.byMonth };

  if (preferred === "pie") {
    if (status.points.length) charts.push(status);
    else if (owner.points.length) charts.push({ ...owner, kind: "pie", title: value ? "Value by owner" : "By owner" });
  } else if (preferred === "line") {
    if (trend.points.length) charts.push(trend);
    else if (status.points.length) charts.push({ ...status, kind: "bar", title: value ? "Value by status" : "By status" });
  } else if (preferred === "bar") {
    if (owner.points.length > 1) charts.push(owner);
    else if (status.points.length) charts.push({ ...status, kind: "bar" });
  } else if (value) {
    if (status.points.length) charts.push({ ...status, kind: "bar" });
    if (trend.points.length >= 2) charts.push(trend);
    else if (owner.points.length > 1 && charts.length < 2) charts.push(owner);
  } else {
    if (status.points.length) charts.push(intent.stack === "count" ? status : { ...status, kind: "bar", title: "By status" });
    if (trend.points.length >= 2) charts.push(trend);
    else if (owner.points.length > 1 && charts.length < 2) charts.push(owner);
  }

  const picked = charts.filter((chart) => chart.points.length > 0).slice(0, 2);
  if (value && summary.currencySymbol) {
    return picked.map((chart) => ({ ...chart, currencySymbol: summary.currencySymbol }));
  }
  return picked;
}

export function localAnalysis(question: string, summary: DatasetSummary): string {
  const money = (n: number) => `**${formatAmount(n, summary.currencySymbol)}**`;
  const count = (n: number) => `**${n.toLocaleString()}**`;
  const topStatus = summary.byStatus[0];
  const topOwner = summary.byOwner[0];
  const lines: string[] = [];
  if (summary.metric === "value") {
    lines.push(`Total value: ${money(summary.amount)} across ${count(summary.shown)} records.`);
  } else {
    lines.push(`Showing ${count(summary.shown)} of ${count(summary.total)} records.`);
    if (summary.amount > 0) lines.push(`Value in these records: ${money(summary.amount)}.`);
  }
  if (topStatus) {
    lines.push(
      summary.metric === "value"
        ? `Largest value bucket is ${topStatus.label} (${money(topStatus.value)}).`
        : `Largest status bucket is ${topStatus.label} (${count(topStatus.value)}).`,
    );
  }
  if (topOwner) {
    lines.push(
      summary.metric === "value"
        ? `Highest value owner is ${topOwner.label} (${money(topOwner.value)}).`
        : `Most records sit with ${topOwner.label} (${count(topOwner.value)}).`,
    );
  }
  if (summary.byMonth.length >= 2) {
    const first = summary.byMonth[0];
    const last = summary.byMonth[summary.byMonth.length - 1];
    const firstText = summary.metric === "value" ? money(first.value) : count(first.value);
    const lastText = summary.metric === "value" ? money(last.value) : count(last.value);
    lines.push(`Moved from ${firstText} in ${first.label} to ${lastText} in ${last.label}.`);
  }
  lines.push(`Question: ${question}`);
  return lines.join(" ");
}

