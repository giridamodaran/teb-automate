import type { GridColumnDef, GridCustomView } from "@/lib/grid/types";
import { currencySymbolFrom, formatAmount, isMoneyColumn } from "@/lib/money";

export function columnCode(column: GridColumnDef): string {
  return (column.code || column.property || "").toUpperCase();
}

const CODE_ALIASES: Record<string, string[]> = {
  TITLE: ["QUOTETITLE", "TITLE"],
  QUOTETITLE: ["QUOTETITLE", "TITLE"],
  OWNER: ["OWNERNAME", "OWNER"],
  OWNERNAME: ["OWNERNAME", "OWNER"],
  ASSIGNED: ["ASSIGNEE", "ASSIGNED"],
  ASSIGNEE: ["ASSIGNEE", "ASSIGNED"],
};

export function findCatalogColumn(catalog: GridColumnDef[], code: string, title?: string): GridColumnDef | undefined {
  const needle = code.trim().toUpperCase();
  if (!needle) return undefined;
  const aliases = CODE_ALIASES[needle] ?? [needle];
  return (
    catalog.find((column) => aliases.includes(columnCode(column))) ??
    catalog.find((column) => aliases.includes(column.property.toUpperCase())) ??
    catalog.find((column) => column.sortColumn && aliases.includes(column.sortColumn.toUpperCase())) ??
    catalog.find((column) => title && column.title.toUpperCase() === title.trim().toUpperCase())
  );
}

export function visibleColumnsFromView(
  catalog: GridColumnDef[],
  view: GridCustomView | null,
  fallbackCodes: string[],
): GridColumnDef[] {
  if (!view || view.Columns.length === 0) {
    const fallback = fallbackCodes
      .map((code) => findCatalogColumn(catalog, code))
      .filter((column): column is GridColumnDef => Boolean(column));
    return fallback.length > 0 ? fallback : catalog;
  }
  const visible: GridColumnDef[] = [];
  for (const item of [...view.Columns].sort((a, b) => a.Sequence - b.Sequence)) {
    const match = findCatalogColumn(catalog, item.Code, item.Title);
    if (match) {
      visible.push({ ...match, title: item.Title || match.title });
      continue;
    }
    if (!item.Code) continue;
    visible.push({
      code: item.Code,
      property: item.Code,
      title: item.Title || item.Code,
      dataType: /date/i.test(item.Code) ? "DATE" : isMoneyColumn(item.Code) ? "MONEY" : "STRING",
      sortColumn: item.Code.toLowerCase(),
      widthClass: "min-w-40",
      primary: /^(TITLE|QUOTETITLE)$/i.test(item.Code),
    });
  }
  return visible.length > 0 ? visible : catalog;
}

export function mergeCatalogWithView(catalog: GridColumnDef[], view: GridCustomView | null): GridColumnDef[] {
  if (!view) return catalog;
  const extra: GridColumnDef[] = [];
  for (const item of view.Columns) {
    if (findCatalogColumn(catalog, item.Code, item.Title)) continue;
    extra.push({
      code: item.Code,
      property: item.Code,
      title: item.Title || item.Code,
      dataType: /date/i.test(item.Code) ? "DATE" : isMoneyColumn(item.Code) ? "MONEY" : "STRING",
      sortColumn: item.Code.toLowerCase(),
      widthClass: "min-w-40",
    });
  }
  return extra.length ? [...catalog, ...extra] : catalog;
}

export function readCell(row: Record<string, unknown>, column: GridColumnDef): unknown {
  const keys = [column.property, column.code, column.property.replace(/Name$/, "")];
  for (const key of keys) {
    if (key && row[key] != null && row[key] !== "") return row[key];
  }
  const lower = column.property.toLowerCase();
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase() === lower) return value;
  }
  return "";
}

export function formatGridCell(value: unknown, column: GridColumnDef, row?: Record<string, unknown>): string {
  if (/CURRENCYSYMBOL|CURRENCYICON/i.test(column.code || column.property)) {
    return currencySymbolFrom(row ?? null) || (value == null ? "" : String(value));
  }
  if (value == null || value === "") return "";
  if (column.dataType === "DATE") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  if (column.dataType === "MONEY" || column.dataType === "NUMBER" || isMoneyColumn(column.code || column.property, column.dataType)) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) return formatAmount(numeric, currencySymbolFrom(row ?? null));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj.Text ?? obj.Name ?? obj.Title ?? obj.Value ?? "").trim();
  }
  return String(value);
}
