import { tebRequest } from "@/lib/api/client";
import type { TebApiEnvelope } from "@/lib/api/types";
import type { GridCustomView, GridViewColumn, GridViewContext } from "@/lib/grid/types";

function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["value", "Value", "Data", "d"]) {
      const nested = obj[key];
      if (typeof nested === "string") {
        try {
          return unwrapList(JSON.parse(nested));
        } catch {
          continue;
        }
      }
      if (Array.isArray(nested)) return nested;
    }
  }
  if (typeof raw === "string") {
    try {
      return unwrapList(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function asView(row: Record<string, unknown>): GridCustomView | null {
  const id = String(row.Id ?? row.id ?? "").trim();
  const columnsRaw = Array.isArray(row.Columns)
    ? row.Columns
    : Array.isArray(row.CustomFields)
      ? row.CustomFields
      : [];
  const columns: GridViewColumn[] = columnsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      Code: String(item.Code ?? item.Property ?? "").trim(),
      Sequence: Number(item.Sequence ?? index + 1) || index + 1,
      Title: item.Title != null ? String(item.Title) : undefined,
      Group: item.Group != null ? String(item.Group) : undefined,
    }))
    .filter((item) => item.Code);
  columns.sort((a, b) => a.Sequence - b.Sequence);
  return {
    Id: id,
    Title: String(row.Title ?? row.Name ?? "View").trim() || "View",
    IsDefault: Boolean(row.IsDefault === true || row.IsDefault === 1 || row.IsDefault === "1"),
    Columns: columns,
  };
}

function parseViews(envelope: TebApiEnvelope): GridCustomView[] {
  const rows = unwrapList(envelope.value ?? envelope.Value ?? envelope.Data ?? envelope);
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map(asView)
    .filter((view): view is GridCustomView => Boolean(view));
}

async function companyPost<T>(method: string, paramName: string, payload: unknown): Promise<TebApiEnvelope<T>> {
  return tebRequest<T>("COMPANY", method, {
    method: "POST",
    body: { [paramName]: payload },
  });
}

export async function listGridViews(context: GridViewContext): Promise<GridCustomView[]> {
  const envelope = await companyPost("AcGetGridColumns", "screendetail", {
    Module: context.module,
    ScreenCode: context.screenCode,
  });
  return parseViews(envelope);
}

export async function addGridColumn(
  context: GridViewContext,
  customViewId: string,
  code: string,
  sequence: number,
): Promise<void> {
  await companyPost("AcAddGridColumns", "columns", {
    Code: code,
    Module: context.module,
    ScreenCode: context.screenCode,
    Sequence: sequence,
    CustomViewId: customViewId,
  });
}

export async function removeGridColumn(
  context: GridViewContext,
  customViewId: string,
  code: string,
  sequence: number,
): Promise<void> {
  await companyPost("AcRemoveGridColumns", "columns", {
    Code: code,
    Module: context.module,
    ScreenCode: context.screenCode,
    Sequence: sequence,
    CustomViewId: customViewId,
  });
}

export async function createGridView(
  context: GridViewContext,
  title: string,
  columns: GridViewColumn[],
): Promise<void> {
  await companyPost("AcAddCustomView", "customview", {
    Title: title,
    Module: context.module,
    ScreenCode: context.screenCode,
    CustomFields: columns,
  });
}

export async function renameGridView(context: GridViewContext, viewId: string, title: string): Promise<void> {
  await companyPost("AcUpdateCustomViewTitle", "customview", {
    Id: viewId,
    Title: title,
    Module: context.module,
    ScreenCode: context.screenCode,
  });
}

export function pickDefaultView(views: GridCustomView[]): GridCustomView | null {
  return views.find((view) => view.IsDefault) ?? views[0] ?? null;
}
