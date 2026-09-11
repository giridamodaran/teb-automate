"use client";

import { useEffect, useState } from "react";
import {
  downloadQuoteTemplate,
  getQuoteMailDefaults,
  listQuoteFromEmails,
  listQuoteTemplates,
  previewQuoteTemplate,
  sendQuoteMail,
} from "@/lib/api/quote-mail";
import { TebApiError } from "@/lib/api/types";
import type { LookupOption } from "@/lib/api/quote-lookups";
import { Icon, IconLabel } from "@/components/ui/Icon";

export function QuoteMailDialog({
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
  const [fromId, setFromId] = useState("");
  const [toMail, setToMail] = useState("");
  const [ccMail, setCcMail] = useState("");
  const [bccMail, setBccMail] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [fromOptions, setFromOptions] = useState<LookupOption[]>([]);
  const [templates, setTemplates] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyTemplate, setBusyTemplate] = useState<"preview" | "download" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setNotice("");
    setLoading(true);
    Promise.all([
      getQuoteMailDefaults(quoteId),
      listQuoteFromEmails(locationId).catch(() => [] as LookupOption[]),
      listQuoteTemplates(locationId).catch(() => [] as LookupOption[]),
    ])
      .then(([defaults, fromRows, templateRows]) => {
        if (cancelled) return;
        setFromOptions(fromRows);
        setTemplates(templateRows);
        setFromId(defaults.fromId || fromRows[0]?.id || "");
        setToMail(defaults.toMail);
        setCcMail(defaults.ccMail);
        setBccMail(defaults.bccMail);
        setTemplateId(defaults.templateId || templateRows[0]?.id || "");
        setSubject(defaults.subject);
        setMessage(defaults.message.replace(/<[^>]+>/g, (tag) => (tag.toLowerCase() === "<br>" || tag.toLowerCase() === "<br/>" ? "\n" : "")).replace(/&nbsp;/g, " "));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof TebApiError ? err.message : "Could not load the email form.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, quoteId, locationId]);

  if (!open) return null;

  async function send() {
    if (!toMail.trim() || !subject.trim() || !fromId) {
      setError("From, To, and Subject are required.");
      return;
    }
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await sendQuoteMail({
        quoteId,
        fromId,
        toMail: toMail.trim(),
        ccMail: ccMail.trim(),
        bccMail: bccMail.trim(),
        templateId,
        subject: subject.trim(),
        message,
      });
      setNotice(result);
      onClose();
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not send the email.");
    } finally {
      setSending(false);
    }
  }

  async function runTemplate(kind: "preview" | "download") {
    if (!templateId) {
      setError("Select a template first.");
      return;
    }
    setBusyTemplate(kind);
    setError("");
    try {
      const url =
        kind === "preview"
          ? await previewQuoteTemplate(quoteId, templateId)
          : await downloadQuoteTemplate(quoteId, templateId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not open the template.");
    } finally {
      setBusyTemplate(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 pt-[6%]" role="dialog" aria-modal="true" aria-labelledby="quote-mail-title">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="quote-mail-title" className="text-base font-semibold text-slate-900">
            Send email
          </h2>
          <button type="button" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {loading ? <p className="text-sm text-slate-500">Loading email defaults…</p> : null}
          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
          {notice ? <p className="mb-3 text-sm text-emerald-700">{notice}</p> : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="font-medium text-slate-600">From</span>
              <select className="rounded-md border border-slate-200 px-2 py-2" value={fromId} onChange={(event) => setFromId(event.target.value)}>
                <option value="">Select sender</option>
                {fromOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="font-medium text-slate-600">To</span>
              <input className="rounded-md border border-slate-200 px-2 py-2" value={toMail} onChange={(event) => setToMail(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-600">Cc</span>
              <input className="rounded-md border border-slate-200 px-2 py-2" value={ccMail} onChange={(event) => setCcMail(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-600">Bcc</span>
              <input className="rounded-md border border-slate-200 px-2 py-2" value={bccMail} onChange={(event) => setBccMail(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="font-medium text-slate-600">Template</span>
              <div className="flex gap-2">
                <select className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-2" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                  <option value="">Select template</option>
                  {templates.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-slate-200 px-2 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  disabled={!templateId || Boolean(busyTemplate)}
                  onClick={() => void runTemplate("preview")}
                >
                  <IconLabel icon="visibility">{busyTemplate === "preview" ? "Opening…" : "View"}</IconLabel>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-slate-200 px-2 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  disabled={!templateId || Boolean(busyTemplate)}
                  onClick={() => void runTemplate("download")}
                >
                  <IconLabel icon="download">{busyTemplate === "download" ? "Opening…" : "PDF"}</IconLabel>
                </button>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="font-medium text-slate-600">Subject</span>
              <input className="rounded-md border border-slate-200 px-2 py-2" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="font-medium text-slate-600">Message</span>
              <textarea className="min-h-32 rounded-md border border-slate-200 px-2 py-2" value={message} onChange={(event) => setMessage(event.target.value)} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={sending || loading}
            className="rounded-md bg-[#086fb8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#065a96] disabled:opacity-50"
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
