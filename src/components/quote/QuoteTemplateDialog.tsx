"use client";

import { useEffect, useState } from "react";
import {
  downloadQuoteTemplate,
  getQuoteMailDefaults,
  listQuoteTemplates,
  previewQuoteTemplate,
} from "@/lib/api/quote-mail";
import { TebApiError } from "@/lib/api/types";
import type { LookupOption } from "@/lib/api/quote-lookups";
import { Icon, IconLabel } from "@/components/ui/Icon";

export function QuoteTemplateDialog({
  quoteId,
  locationId,
  open,
  onClose,
}: {
  quoteId: string;
  locationId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<LookupOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setUrl("");
    setLoading(true);
    void (async () => {
      const [rows, defaults] = await Promise.all([
        listQuoteTemplates(locationId).catch(() => [] as LookupOption[]),
        getQuoteMailDefaults(quoteId).catch(() => null),
      ]);
      if (cancelled) return;
      const selected = defaults?.templateId || rows[0]?.id || "";
      const options =
        selected && !rows.some((row) => row.id === selected)
          ? [{ id: selected, label: "Default template" }, ...rows]
          : rows;
      setTemplates(options);
      setTemplateId(selected);
      if (!selected) {
        setLoading(false);
        return;
      }
      try {
        setUrl(await previewQuoteTemplate(quoteId, selected));
      } catch (err) {
        if (!cancelled) setError(err instanceof TebApiError ? err.message : "Could not load the template.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, quoteId, locationId]);

  if (!open) return null;

  async function loadTemplate(nextId: string) {
    setTemplateId(nextId);
    if (!nextId) {
      setUrl("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setUrl(await previewQuoteTemplate(quoteId, nextId));
    } catch (err) {
      setUrl("");
      setError(err instanceof TebApiError ? err.message : "Could not load the template.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 pt-[4%]" role="dialog" aria-modal="true" aria-labelledby="quote-template-title">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="quote-template-title" className="shrink-0 text-base font-semibold text-slate-900">
            Template
          </h2>
          <select
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            value={templateId}
            onChange={(event) => void loadTemplate(event.target.value)}
          >
            <option value="">Select template</option>
            {templates.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled={!templateId || loading}
            onClick={() => {
              if (!templateId) return;
              void downloadQuoteTemplate(quoteId, templateId)
                .then((href) => window.open(href, "_blank", "noopener,noreferrer"))
                .catch((err) => setError(err instanceof TebApiError ? err.message : "Could not download the template."));
            }}
          >
            <IconLabel icon="download">PDF</IconLabel>
          </button>
          <button type="button" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-slate-100">
          {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
          {loading ? <p className="px-4 py-3 text-sm text-slate-500">Generating template…</p> : null}
          {url ? (
            <embed title="Quote template" src={url} type="application/pdf" className="h-full w-full bg-white" />
          ) : !loading && !error ? (
            <p className="px-4 py-3 text-sm text-slate-500">Select a template to preview this quote.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
