import type { DateFieldType, DatePeriodType, DateRangeIntent, LiveDateFilter } from "@/lib/chat/types";

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local calendar YYYY-MM-DD — never UTC-sliced ISO, which shifts the day in IST. */
export function localYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromLocalYmd(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function asWindowDate(value: string, end: boolean): Date | null {
  const trimmed = value.trim();
  const ymd = fromLocalYmd(trimmed);
  if (ymd) return end ? endOfDay(ymd) : startOfDay(ymd);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return end ? endOfDay(parsed) : startOfDay(parsed);
}

export function periodProperty(fieldType: string): string {
  switch (fieldType) {
    case "UPDATEDFILTER":
    case "NOTUPDATEDFILTER":
      return "modifieddate";
    case "CLOSEDFILTER":
      return "closedate";
    case "SCHEDULEFILTER":
      return "scheduledate";
    case "DUEFILTER":
      return "duedate";
    default:
      return "createddate";
  }
}

export function dateWindow(intent: DateRangeIntent, now = new Date()): { from: Date; to: Date } | null {
  if (intent.mode === "ANY") return null;
  if (intent.from && intent.to) {
    const from = asWindowDate(intent.from, false);
    const to = asWindowDate(intent.to, true);
    if (from && to) return { from, to };
  }
  if (intent.mode === "WITHIN" && intent.period && intent.period > 0) {
    const to = endOfDay(now);
    let from = startOfDay(now);
    if (intent.periodType === "FILTERMONTHS") from = addDays(from, -(intent.period * 30 - 1));
    else if (intent.periodType === "FILTERYEARS") from = addDays(from, -(intent.period * 365 - 1));
    else from = addDays(from, -(intent.period - 1));
    return { from, to };
  }
  return null;
}

export function inDateWindow(date: Date, window: { from: Date; to: Date }): boolean {
  const day = localYmd(date);
  return day >= localYmd(window.from) && day <= localYmd(window.to);
}

function asApiDate(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return localYmd(parsed);
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
}

/** Live Created Filter body: Mode ANY | WITHIN | BETWEEN | FINANCIALPERIOD. Period must be an int — null 400s. */
export function toLiveDateFilter(intent: DateRangeIntent): LiveDateFilter {
  const between = intent.mode === "BETWEEN";
  return {
    FieldType: intent.fieldType,
    Mode: intent.mode,
    DateRange: {
      FromDate: between ? asApiDate(intent.from) : null,
      ToDate: between ? asApiDate(intent.to) : null,
    },
    DatePeriod: {
      Period: intent.mode === "WITHIN" ? intent.period ?? 7 : 0,
      PeriodType: intent.mode === "WITHIN" ? intent.periodType || "FILTERDAYS" : "",
    },
    AnyUpdate: {
      UpdateOn: [],
      PeriodType: intent.anyUpdatePeriodType || "LAST",
      IsNotUpdate: intent.fieldType === "NOTUPDATEDFILTER",
    },
    FinancePeriod: intent.financePeriod || "",
  };
}

export function withinDays(fieldType: DateFieldType, days: number, label: string): DateRangeIntent {
  const now = new Date();
  const from = startOfDay(addDays(now, -(days - 1)));
  const to = startOfDay(now);
  return {
    fieldType,
    mode: "BETWEEN",
    period: days,
    periodType: "FILTERDAYS",
    anyUpdatePeriodType: "LAST",
    from: localYmd(from),
    to: localYmd(to),
    label,
  };
}

export function withinPeriod(
  fieldType: DateFieldType,
  period: number,
  periodType: DatePeriodType,
  label: string,
): DateRangeIntent {
  const now = new Date();
  const window = dateWindow({ fieldType, mode: "WITHIN", period, periodType, label }, now);
  return {
    fieldType,
    mode: "WITHIN",
    period,
    periodType,
    anyUpdatePeriodType: "LAST",
    from: window ? localYmd(window.from) : undefined,
    to: window ? localYmd(window.to) : undefined,
    label,
  };
}

export function betweenRange(fieldType: DateFieldType, from: Date, to: Date, label: string): DateRangeIntent {
  return {
    fieldType,
    mode: "BETWEEN",
    from: localYmd(from),
    to: localYmd(to),
    label,
  };
}

export function anyTime(fieldType: DateFieldType): DateRangeIntent {
  return { fieldType, mode: "ANY", label: "any time" };
}

export function fieldTypeFromText(text: string): DateFieldType {
  if (/\b(not updated|no update)\b/i.test(text)) return "NOTUPDATEDFILTER";
  if (/\b(closed|close date|won date)\b/i.test(text)) return "CLOSEDFILTER";
  if (/\b(updated|modified|last updated|changed)\b/i.test(text)) return "UPDATEDFILTER";
  if (/\b(scheduled|schedule)\b/i.test(text)) return "SCHEDULEFILTER";
  if (/\b(overdue|due date|due)\b/i.test(text)) return "DUEFILTER";
  return "CREATEDFILTER";
}

export const DATE_FIELD_LABEL: Record<DateFieldType, string> = {
  CREATEDFILTER: "created",
  UPDATEDFILTER: "updated",
  NOTUPDATEDFILTER: "not updated",
  CLOSEDFILTER: "closed",
  SCHEDULEFILTER: "scheduled",
  DUEFILTER: "due",
};

export function modeLabel(intent: DateRangeIntent): string {
  const field = DATE_FIELD_LABEL[intent.fieldType];
  if (intent.mode === "WITHIN") {
    return `${field} within last ${intent.period} ${intent.periodType === "FILTERMONTHS" ? "months" : intent.periodType === "FILTERYEARS" ? "years" : "days"}`;
  }
  if (intent.mode === "ANY") return `${field} any`;
  if (intent.mode === "FINANCIALPERIOD") return `${field} financial period`;
  if (/^(last|this|today|yesterday|past)\b/i.test(intent.label) || intent.label.includes("–")) {
    return `${field} ${intent.label}`;
  }
  return `${field} between ${intent.label}`;
}
