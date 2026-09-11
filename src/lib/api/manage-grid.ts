import { tebRequest } from "@/lib/api/client";
import type { TebApiEnvelope } from "@/lib/api/types";
import type { ManageListPage, ManageListQuery } from "@/lib/grid/types";

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asRows(raw: unknown): Record<string, unknown>[] {
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["QuoteDetail", "ItemDetail", "Data", "data", "value", "Value", "Records"]) {
      if (key in obj) {
        const inner = asRows(obj[key]);
        if (inner.length > 0) return inner;
      }
    }
  }
  return [];
}

function asTotal(raw: unknown, fallback: number): number {
  const parsed = parseMaybeJson(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const total = Number(obj.TotalRecord ?? obj.TotalCount ?? obj.total);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  return fallback;
}

/** Live manage list. Quote uses wrapped Action `MANAGE`; some modules use an unwrapped paging body. */
export async function listManageRecords<T = Record<string, unknown>>(
  query: ManageListQuery,
): Promise<ManageListPage<T>> {
  if (query.action) {
    const data: Record<string, unknown> = {
      Module: query.module,
      Code: query.code || query.action,
      PrimaryKey: query.primaryKey ?? "Id",
      Data: JSON.stringify({
        PageNumber: query.pageNumber ?? 0,
        PageSize: query.pageSize ?? 25,
        OrderBy: query.sortColumn ?? "modifieddate",
        SortOrder: query.sortOrder ?? true,
        Search: query.fullTextSearch ?? "",
      }),
      Action: query.action,
      ComponentCode: query.code || query.action,
    };
    if (query.filterId) data.FilterId = query.filterId;
    if (query.filterValues) {
      data.FilterModule = { FilterValues: query.filterValues };
      if (!data.FilterId) data.FilterId = "";
    }
    const envelope = await tebRequest<TebApiEnvelope>("DYNAMIC", "AcGetData", {
      method: "POST",
      body: { data },
    });
    const parsed = parseMaybeJson(envelope.Value ?? envelope.value ?? envelope.Data);
    const rows = asRows(parsed) as T[];
    return { rows, total: asTotal(parsed, rows.length) };
  }

  const data: Record<string, unknown> = {
    Module: query.module,
    FullTextSearch: query.fullTextSearch ?? "",
  };
  if (query.filterId) {
    data.FilterId = query.filterId;
  } else if (query.filterValues) {
    data.FilterValues = query.filterValues;
  } else {
    data.FilterId = null;
    data.FilterValues = null;
  }
  const envelope = await tebRequest<TebApiEnvelope>("DYNAMIC", "AcGetData", {
    method: "POST",
    body: {
      Data: data,
      PageNumber: query.pageNumber ?? 0,
      PageSize: query.pageSize ?? 25,
      SortColumn: query.sortColumn ?? "modifieddate",
      SortOrder: query.sortOrder ?? true,
    },
  });
  const nested = (envelope.Data as TebApiEnvelope | undefined) ?? envelope;
  const rows = asRows(nested.Data ?? envelope.Data ?? envelope.value ?? envelope.Value) as T[];
  const total = asTotal(nested, asTotal(envelope, rows.length));
  return { rows, total };
}
