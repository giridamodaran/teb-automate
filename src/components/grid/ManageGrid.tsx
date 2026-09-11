"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TebApiError } from "@/lib/api/types";
import {
  addGridColumn,
  createGridView,
  listGridViews,
  pickDefaultView,
  removeGridColumn,
  renameGridView,
} from "@/lib/api/grid-views";
import { listManageRecords } from "@/lib/api/manage-grid";
import { GridViewPanel } from "@/components/grid/GridViewPanel";
import { Icon } from "@/components/ui/Icon";
import {
  columnCode,
  formatGridCell,
  mergeCatalogWithView,
  readCell,
  visibleColumnsFromView,
} from "@/lib/grid/columns";
import type { GridColumnDef, GridCustomView, GridViewColumn, GridViewContext } from "@/lib/grid/types";

const PAGE_SIZES = [10, 20, 25, 50, 100];

function toViewColumns(columns: GridColumnDef[]): GridViewColumn[] {
  return columns.map((column, index) => ({
    Code: columnCode(column),
    Sequence: index + 1,
    Title: column.title,
  }));
}

export function ManageGrid({
  title,
  listModule,
  listAction,
  listCode,
  listPrimaryKey,
  viewContext,
  catalog,
  fallbackCodes,
  addHref,
  addLabel = "Add",
  rowHref,
  getCellValue,
}: {
  title: string;
  listModule: string;
  listAction?: string;
  listCode?: string;
  listPrimaryKey?: string;
  viewContext: GridViewContext;
  catalog: GridColumnDef[];
  fallbackCodes: string[];
  addHref?: string;
  addLabel?: string;
  rowHref?: (row: Record<string, unknown>) => string | null;
  getCellValue?: (row: Record<string, unknown>, column: GridColumnDef) => unknown;
}) {
  const router = useRouter();
  const [views, setViews] = useState<GridCustomView[]>([]);
  const [viewId, setViewId] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortColumn, setSortColumn] = useState("modifieddate");
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [error, setError] = useState("");
  const [viewError, setViewError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsRef = useRef<HTMLDivElement>(null);

  const currentView = useMemo(
    () => views.find((view) => view.Id === viewId) ?? pickDefaultView(views),
    [views, viewId],
  );
  const mergedCatalog = useMemo(() => mergeCatalogWithView(catalog, currentView), [catalog, currentView]);
  const columns = useMemo(
    () => visibleColumnsFromView(mergedCatalog, currentView, fallbackCodes),
    [mergedCatalog, currentView, fallbackCodes],
  );
  const enabledCodes = columns.map((column) => columnCode(column));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const loadViews = useCallback(async () => {
    try {
      const next = await listGridViews(viewContext);
      setViews(next);
      setViewId((current) => {
        if (current && next.some((view) => view.Id === current)) return current;
        return pickDefaultView(next)?.Id ?? "";
      });
    } catch (err) {
      setViewError(err instanceof TebApiError ? err.message : "Could not load grid views.");
    }
  }, [viewContext.module, viewContext.screenCode, viewContext]);

  const loadRows = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const result = await listManageRecords({
        module: listModule,
        action: listAction,
        code: listCode,
        primaryKey: listPrimaryKey,
        pageNumber: page,
        pageSize,
        sortColumn,
        sortOrder: sortDesc,
        fullTextSearch: debouncedSearch,
      });
      setRows(result.rows as Record<string, unknown>[]);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not load records.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [debouncedSearch, listAction, listCode, listModule, listPrimaryKey, page, pageSize, sortColumn, sortDesc]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!viewsRef.current?.contains(event.target as Node)) setViewsOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function ensureView(): Promise<GridCustomView | null> {
    if (currentView?.Id) return currentView;
    setSavingView(true);
    try {
      await createGridView(viewContext, "Default View", toViewColumns(columns));
      const next = await listGridViews(viewContext);
      setViews(next);
      const created = pickDefaultView(next);
      if (created) setViewId(created.Id);
      return created;
    } finally {
      setSavingView(false);
    }
  }

  async function handleToggle(code: string, enabled: boolean) {
    setViewError("");
    setSavingView(true);
    try {
      const view = await ensureView();
      if (!view?.Id) return;
      const current = enabledCodes;
      if (enabled) {
        await addGridColumn(viewContext, view.Id, code, current.length + 1);
      } else {
        const sequence = Math.max(1, current.findIndex((item) => item === code) + 1);
        await removeGridColumn(viewContext, view.Id, code, sequence);
      }
      await loadViews();
    } catch (err) {
      setViewError(err instanceof TebApiError ? err.message : "Could not update columns.");
    } finally {
      setSavingView(false);
    }
  }

  async function handleMove(code: string, direction: -1 | 1) {
    const index = enabledCodes.indexOf(code);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= enabledCodes.length) return;
    setViewError("");
    setSavingView(true);
    try {
      const view = await ensureView();
      if (!view?.Id) return;
      await addGridColumn(viewContext, view.Id, code, nextIndex + 1);
      await loadViews();
    } catch (err) {
      setViewError(err instanceof TebApiError ? err.message : "Could not reorder columns.");
    } finally {
      setSavingView(false);
    }
  }

  async function handleRename(nextTitle: string) {
    if (!currentView?.Id) return;
    setSavingView(true);
    setViewError("");
    try {
      await renameGridView(viewContext, currentView.Id, nextTitle);
      await loadViews();
    } catch (err) {
      setViewError(err instanceof TebApiError ? err.message : "Could not rename the view.");
    } finally {
      setSavingView(false);
    }
  }

  function handleSort(column: GridColumnDef) {
    const key = column.sortColumn || column.property.toLowerCase();
    if (sortColumn === key) {
      setSortDesc((value) => !value);
      setPage(0);
      return;
    }
    setSortColumn(key);
    setSortDesc(column.dataType === "DATE");
    setPage(0);
  }

  function cellText(row: Record<string, unknown>, column: GridColumnDef): string {
    const override = getCellValue?.(row, column);
    const raw = override === undefined ? readCell(row, column) : override;
    return formatGridCell(raw, column, row);
  }

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500">
            {loading ? "Loading…" : `${total} record${total === 1 ? "" : "s"}`}
          </p>
        </div>
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-[#086fb8] focus:ring-2 focus:ring-[#086fb8]/20"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="relative" ref={viewsRef}>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setViewsOpen((open) => !open)}
          >
            <Icon name="view_column" size={18} />
            {currentView?.Title || "Grid view"}
            <Icon name="expand_more" size={18} />
          </button>
          {viewsOpen ? (
            <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {views.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">Default columns</p> : null}
              {views.map((view) => (
                <button
                  key={view.Id || view.Title}
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                    view.Id === currentView?.Id ? "font-semibold text-[#086fb8]" : "text-slate-700"
                  }`}
                  onClick={() => {
                    setViewId(view.Id);
                    setViewsOpen(false);
                  }}
                >
                  {view.Title}
                </button>
              ))}
              <button
                type="button"
                className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setViewsOpen(false);
                  setPanelOpen(true);
                }}
              >
                Customize columns…
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
          onClick={() => void loadRows()}
          aria-label="Refresh"
        >
          <Icon name="refresh" size={20} className={refreshing ? "animate-spin" : ""} />
        </button>
        {addHref ? (
          <Link
            href={addHref}
            className="inline-flex items-center gap-1 rounded-md bg-[#086fb8] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#065a96]"
          >
            <Icon name="add" size={18} />
            {addLabel}
          </Link>
        ) : null}
      </header>

      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-[#f8fafc]">
            <tr>
              {columns.map((column) => {
                const key = column.sortColumn || column.property.toLowerCase();
                const active = sortColumn === key;
                return (
                  <th
                    key={columnCode(column)}
                    className={`border-b border-slate-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 ${column.widthClass ?? "min-w-36"}`}
                  >
                    <button type="button" className="inline-flex items-center gap-1 hover:text-slate-800" onClick={() => handleSort(column)}>
                      {column.title}
                      <Icon
                        name={active ? (sortDesc ? "arrow_downward" : "arrow_upward") : "unfold_more"}
                        size={16}
                        className="text-slate-400"
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={Math.max(1, columns.length)}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={Math.max(1, columns.length)}>
                  No records match this view.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const id = String(row.Id ?? row.id ?? "");
                const href = rowHref?.(row) ?? null;
                return (
                  <tr
                    key={id || index}
                    className="group cursor-pointer hover:bg-sky-50/70"
                    onClick={() => {
                      if (href) router.push(href);
                    }}
                  >
                    {columns.map((column) => {
                      const text = cellText(row, column);
                      const isPrimary = Boolean(column.primary);
                      return (
                        <td
                          key={columnCode(column)}
                          className={`border-b border-slate-100 px-3 py-2.5 ${isPrimary ? "font-medium text-[#086fb8]" : "text-slate-700"}`}
                        >
                          {href && isPrimary ? (
                            <Link href={href} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                              {text || "—"}
                            </Link>
                          ) : (
                            text || "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
        <p>
          {from}–{to} of {total}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.06em] text-slate-400">Rows</span>
            <select
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40"
              disabled={page <= 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Prev
            </button>
            <span className="px-2 text-xs text-slate-500">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </footer>

      <GridViewPanel
        open={panelOpen}
        title={`Edit ${title} column`}
        catalog={mergedCatalog}
        view={currentView}
        enabledCodes={enabledCodes}
        saving={savingView}
        error={viewError}
        onClose={() => setPanelOpen(false)}
        onToggle={(code, enabled) => void handleToggle(code, enabled)}
        onMove={(code, direction) => void handleMove(code, direction)}
        onRename={currentView?.Id ? (next) => void handleRename(next) : undefined}
      />
    </section>
  );
}
