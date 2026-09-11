"use client";

import { useEffect, useMemo, useState } from "react";
import type { GridColumnDef, GridCustomView } from "@/lib/grid/types";
import { columnCode } from "@/lib/grid/columns";
import { Icon } from "@/components/ui/Icon";

export function GridViewPanel({
  open,
  title,
  catalog,
  view,
  enabledCodes,
  saving,
  error,
  onClose,
  onToggle,
  onMove,
  onRename,
}: {
  open: boolean;
  title: string;
  catalog: GridColumnDef[];
  view: GridCustomView | null;
  enabledCodes: string[];
  saving?: boolean;
  error?: string;
  onClose: () => void;
  onToggle: (code: string, enabled: boolean) => void;
  onMove: (code: string, direction: -1 | 1) => void;
  onRename?: (title: string) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(view?.Title ?? "");
  useEffect(() => {
    setDraftTitle(view?.Title ?? "");
  }, [view?.Id, view?.Title]);
  const enabledSet = useMemo(() => new Set(enabledCodes.map((code) => code.toUpperCase())), [enabledCodes]);
  const uniqueCatalog = useMemo(() => {
    const seen = new Set<string>();
    return catalog.filter((column) => {
      const key = column.property.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [catalog]);
  const ordered = useMemo(() => {
    const enabled = enabledCodes
      .map((code) => uniqueCatalog.find((column) => columnCode(column) === code.toUpperCase()) ?? catalog.find((column) => columnCode(column) === code.toUpperCase()))
      .filter((column): column is GridColumnDef => Boolean(column));
    const rest = uniqueCatalog.filter((column) => !enabledSet.has(columnCode(column)) && !enabled.some((row) => row.property.toLowerCase() === column.property.toLowerCase()));
    return [...enabled, ...rest];
  }, [catalog, enabledCodes, enabledSet, uniqueCatalog]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="settings" size={20} className="text-[#086fb8]" />
            <div>
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="text-xs text-slate-500">Enable, hide, and reorder columns for this view</p>
            </div>
          </div>
          <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </header>

        {onRename ? (
          <div className="border-b border-slate-100 px-4 py-3">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">View name</label>
            <div className="mt-1 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
              <button
                type="button"
                className="rounded-md bg-[#086fb8] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={!draftTitle.trim() || draftTitle.trim() === view?.Title || saving}
                onClick={() => onRename(draftTitle.trim())}
              >
                Rename
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="px-4 py-2 text-sm text-red-600">{error}</p> : null}

        <ul className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {ordered.map((column) => {
            const code = columnCode(column);
            const enabled = enabledSet.has(code);
            const enabledIndex = enabledCodes.findIndex((item) => item.toUpperCase() === code);
            return (
              <li
                key={code}
                className={`mb-1 flex items-center gap-2 rounded-lg border px-2 py-2 ${
                  enabled ? "border-slate-200 bg-white" : "border-transparent bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => onToggle(code, event.target.checked)}
                  disabled={saving}
                />
                <span className={`min-w-0 flex-1 truncate text-sm ${enabled ? "text-slate-800" : "text-slate-500"}`}>
                  {column.title}
                </span>
                {enabled ? (
                  <span className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      disabled={saving || enabledIndex <= 0}
                      onClick={() => onMove(code, -1)}
                      aria-label={`Move ${column.title} up`}
                    >
                      <Icon name="keyboard_arrow_up" size={18} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      disabled={saving || enabledIndex < 0 || enabledIndex >= enabledCodes.length - 1}
                      onClick={() => onMove(code, 1)}
                      aria-label={`Move ${column.title} down`}
                    >
                      <Icon name="keyboard_arrow_down" size={18} />
                    </button>
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">Hidden</span>
                )}
              </li>
            );
          })}
        </ul>
        {saving ? <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Saving column settings…</p> : null}
      </aside>
    </div>
  );
}
