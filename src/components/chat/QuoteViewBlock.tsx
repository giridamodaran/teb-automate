"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadQuoteTemplatePdf } from "@/lib/api/quote-view";
import type { QuoteView, QuoteViewItem, QuoteViewTemplate } from "@/lib/chat/types";
import { Icon } from "@/components/ui/Icon";

function OpenInTeb({ href, label = "Open in TEB" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#086fb8] hover:border-[#086fb8]"
    >
      <Icon name="open_in_new" size={13} />
      {label}
    </a>
  );
}

function itemMeta(item: QuoteViewItem): string {
  const qty = [item.quantity, item.unit].filter(Boolean).join(" ");
  const price = item.unitPrice ? `${qty ? `${qty} × ` : ""}${item.unitPrice}` : qty;
  return [price, item.sku, item.brand].filter(Boolean).join(" · ");
}

function QuoteReceipt({ view }: { view: QuoteView }) {
  const items = view.items.slice(0, 20);
  const total = view.breakdown.find((line) => line.emphasis) ?? view.breakdown[view.breakdown.length - 1];
  const otherLines = view.breakdown.filter((line) => line !== total);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Quote</p>
        {total ? <p className="text-[15px] font-semibold tabular-nums text-slate-900">{total.value}</p> : null}
      </header>
      <div className="divide-y divide-slate-100">
        {items.length ? (
          items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-5 text-slate-900">{item.name}</p>
                {itemMeta(item) ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{itemMeta(item)}</p> : null}
              </div>
              <p className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">{item.netAmount || "—"}</p>
            </div>
          ))
        ) : view.itemNames.length ? (
          <p className="px-3.5 py-2.5 text-[13px] text-slate-700">{view.itemNames.join(", ")}</p>
        ) : (
          <p className="px-3.5 py-2.5 text-[13px] text-slate-500">No items on this quote.</p>
        )}
      </div>
      {view.breakdown.length ? (
        <div className="border-t border-slate-100 bg-slate-50/80 px-3.5 py-3">
          <div className="space-y-1.5">
            {otherLines.map((line) => (
              <div key={line.title} className="flex items-baseline justify-between gap-4">
                <span className="text-[12px] text-slate-500">{line.title}</span>
                <span className="text-[13px] font-medium tabular-nums text-slate-800">{line.value}</span>
              </div>
            ))}
          </div>
          {total ? (
            <div className="mt-2.5 flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2.5">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">{total.title}</span>
              <span className="text-[16px] font-semibold tabular-nums text-[#086fb8]">{total.value}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {view.items.length > items.length ? (
        <p className="border-t border-slate-100 px-3.5 py-2 text-[11px] text-slate-500">
          {view.items.length - items.length} more items — <OpenInTeb href={view.openUrl} />
        </p>
      ) : null}
    </section>
  );
}

function TemplatePdf({ view }: { view: QuoteView }) {
  const templates = view.templates;
  const initial = templates.find((row) => row.isSelected) ?? templates[0];
  const [activeId, setActiveId] = useState(initial?.id || "");
  const [pdfById, setPdfById] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const row of templates) {
      if (row.pdfUrl) seed[row.id] = row.pdfUrl;
    }
    return seed;
  });
  const [error, setError] = useState("");
  const cacheRef = useRef<Record<string, string>>({});
  const active = useMemo(
    () => templates.find((row) => row.id === activeId) ?? templates[0],
    [templates, activeId],
  );
  const pdfUrl = active ? pdfById[active.id] : "";
  const busy = Boolean(active) && !pdfUrl && !error;

  useEffect(() => {
    let cancelled = false;
    for (const row of templates) {
      if (row.pdfUrl && !cacheRef.current[row.id]) cacheRef.current[row.id] = row.pdfUrl;
    }
    async function load(row: QuoteViewTemplate, isActive: boolean) {
      if (!row?.id || cacheRef.current[row.id]) return;
      try {
        const url = await downloadQuoteTemplatePdf(view.id, row.id);
        if (cancelled) return;
        if (url) {
          cacheRef.current[row.id] = url;
          setPdfById((current) => ({ ...current, [row.id]: url }));
        } else if (isActive) {
          setError("This template PDF was not returned.");
        }
      } catch {
        if (!cancelled && isActive) setError("I couldn't load that PDF. Try again, or open the quote in TEB.");
      }
    }
    const activeRow = templates.find((row) => row.id === activeId) ?? templates[0];
    if (activeRow) void load(activeRow, true);
    const timer = window.setTimeout(() => {
      templates
        .filter((row) => row.id !== activeRow?.id)
        .slice(0, 7)
        .forEach((row) => void load(row, false));
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view.id, activeId, templates]);

  if (!templates.length) return null;

  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">PDF templates</p>
      <div className="flex flex-wrap gap-1.5">
        {templates.map((row) => {
          const selected = row.id === active?.id;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setError("");
                setActiveId(row.id);
              }}
              className={`rounded-full border px-2.5 py-1 text-[12px] ${
                selected
                  ? "border-[#086fb8] bg-[#086fb8] text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {row.name}
              {row.isDefault ? " · default" : ""}
            </button>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <p className="truncate text-[12px] font-medium text-slate-800">{active?.name || "Template"}</p>
          {pdfUrl ? <OpenInTeb href={pdfUrl} label="Open PDF" /> : null}
        </div>
        {pdfUrl ? (
          <iframe title={`${active?.name || "Quote"} PDF`} src={pdfUrl} className="h-[28rem] w-full bg-white" />
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-1 px-4 text-center">
            <Icon name={busy ? "progress_activity" : "picture_as_pdf"} size={22} className={`text-slate-400 ${busy ? "animate-spin" : ""}`} />
            <p className="text-[12px] text-slate-500">
              {busy ? "Preparing PDF…" : error || "Pick a template to preview its PDF."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function QuoteViewBlock({ view }: { view: QuoteView }) {
  const statusBits = [view.status, view.workflow, view.closed ? "Closed" : "", view.nextStatus ? `Next: ${view.nextStatus}` : ""].filter(
    Boolean,
  );
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-5 text-slate-900">{view.title}</p>
            <p className="mt-1 text-[12px] text-slate-500">
              {[view.code, view.company, view.contact, view.owner].filter(Boolean).join(" · ")}
            </p>
          </div>
          <OpenInTeb href={view.openUrl} />
        </div>
        {statusBits.length ? (
          <p className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
            {statusBits.join(" · ")}
          </p>
        ) : null}
        {view.fields.length ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            {view.fields.map((field) => (
              <div key={field.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{field.label}</dt>
                <dd className="mt-0.5 text-[12px] text-slate-800">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <QuoteReceipt view={view} />
      <TemplatePdf view={view} />
      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Notes</p>
        {view.notes.length ? (
          <div className="space-y-1.5">
            {view.notes.slice(0, 8).map((note) => (
              <div key={note.id} className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-[12px]">
                <p className="whitespace-pre-wrap leading-5 text-slate-800">{note.text}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {[note.pinned ? "Pinned" : "", note.author, note.date].filter(Boolean).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-slate-500">No notes on this quote.</p>
        )}
      </section>
      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Actions</p>
        {view.actions.length ? (
          <div className="space-y-1">
            {view.actions.slice(0, 8).map((action) => (
              <div key={action.id} className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-[12px]">
                <p className="text-slate-800">{action.type}</p>
                {action.assignee || action.schedule ? (
                  <p className="text-[11px] text-slate-500">{[action.assignee, action.schedule].filter(Boolean).join(" · ")}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-slate-500">No actions on this quote.</p>
        )}
      </section>
    </div>
  );
}
