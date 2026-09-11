"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteQuoteTerm,
  listQuoteTermTypes,
  listQuoteTerms,
  saveQuoteTerm,
  type QuoteTermSet,
} from "@/lib/api/quote-terms";
import { stripNoteHtml } from "@/lib/api/notes";
import { TebApiError } from "@/lib/api/types";
import type { LookupOption } from "@/lib/api/quote-lookups";
import { Icon } from "@/components/ui/Icon";

export function QuoteTermsPanel({ quoteId }: { quoteId: string }) {
  const [sets, setSets] = useState<QuoteTermSet[]>([]);
  const [types, setTypes] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const rows = await listQuoteTerms(quoteId);
    setSets(rows);
  }, [quoteId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([reload(), listQuoteTermTypes()])
      .then(([, typeRows]) => {
        if (cancelled) return;
        setTypes(typeRows);
        if (typeRows[0] && !typeId) setTypeId(typeRows[0].id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof TebApiError ? err.message : "Could not load terms.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId, reload]);

  const terms = sets.flatMap((set) => set.EntityTermDetail.map((term) => ({ set, term })));

  async function addTerm() {
    if (!title.trim() || !text.trim() || !typeId) {
      setError("Title, type, and text are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveQuoteTerm({
        quoteId,
        setId: sets[0]?.Id,
        masterTermSetId: sets[0]?.MasterTermSetId,
        title: title.trim(),
        typeId,
        text: text.trim(),
      });
      setTitle("");
      setText("");
      setAdding(false);
      await reload();
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not save the term.");
    } finally {
      setSaving(false);
    }
  }

  async function removeTerm(setId: string, termId: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) return;
    setError("");
    try {
      await deleteQuoteTerm(setId, termId);
      await reload();
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not delete the term.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Terms & conditions</p>
        <button
          type="button"
          className="text-[#086fb8] hover:text-[#065a96]"
          aria-label={adding ? "Cancel add term" : "Add term"}
          onClick={() => setAdding((current) => !current)}
        >
          <Icon name={adding ? "close" : "add"} size={18} />
        </button>
      </div>
      {error ? <p className="px-3 pb-1 text-[12px] text-red-600">{error}</p> : null}
      {adding ? (
        <div className="mx-3 mb-2 space-y-2 rounded-lg border border-slate-200 p-2">
          <input
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <select className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            <option value="">Type</option>
            {types.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <textarea
            className="h-16 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            placeholder="Term text"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            type="button"
            disabled={saving}
            className="rounded-md bg-[#086fb8] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#065a96] disabled:opacity-50"
            onClick={() => void addTerm()}
          >
            {saving ? "Saving…" : "Save term"}
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
        {loading ? <p className="text-[12px] text-slate-400">Loading terms…</p> : null}
        {!loading && terms.length === 0 ? <p className="text-[12px] text-slate-400">No terms on this quote.</p> : null}
        <ul className="space-y-2">
          {terms.map(({ set, term }) => (
            <li key={`${set.Id}-${term.Id}`} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-slate-800">{term.TermTitle}</p>
                  {term.TermType ? <p className="text-[10px] uppercase tracking-wide text-slate-400">{term.TermType}</p> : null}
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-slate-600">{stripNoteHtml(term.TermText) || "—"}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-slate-400 hover:text-red-600"
                  aria-label={`Delete ${term.TermTitle}`}
                  onClick={() => void removeTerm(set.Id, term.Id, term.TermTitle)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
