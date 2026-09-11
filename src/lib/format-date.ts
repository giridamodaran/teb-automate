/** Stored API timestamps → local display. Leaves already-friendly text alone. */

const STORED =
  /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;
const MS_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;

function parseStoredDate(text: string): { date: Date; hasTime: boolean } | null {
  const ms = text.match(MS_DATE);
  if (ms) {
    const date = new Date(Number(ms[1]));
    return Number.isNaN(date.getTime()) ? null : { date, hasTime: true };
  }
  if (!STORED.test(text)) return null;
  const hasTime = /T\d{2}:\d{2}|\s\d{2}:\d{2}/i.test(text);
  if (!hasTime) {
    const [year, month, day] = text.slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return null;
    return { date: new Date(year, month - 1, day), hasTime: false };
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : { date, hasTime: true };
}

export function parseApiDate(raw: unknown): Date | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parsed = parseStoredDate(text);
  if (parsed) return parsed.date;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatFriendlyDate(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const parsed = parseStoredDate(text);
  if (!parsed) return text;
  if (parsed.hasTime) {
    return parsed.date.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return parsed.date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
