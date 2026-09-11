"use client";

import { useCallback, useState } from "react";
import { NotesPanel } from "@/components/tools/NotesPanel";
import { QuoteTermsPanel } from "@/components/quote/QuoteTermsPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Icon, IconLabel } from "@/components/ui/Icon";
import { personName, stripNoteHtml, type NotesContext, type NotesStats } from "@/lib/api/notes";

type Pane = "notes" | "actions" | "terms";

export function EntityToolsPanel({
  entityId,
  module,
  open,
  onOpenChange,
}: NotesContext & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pane, setPane] = useState<Pane>("notes");
  const [stats, setStats] = useState<NotesStats | null>(null);

  const show = useCallback(
    (next: Pane) => {
      setPane(next);
      if (!open) onOpenChange(true);
    },
    [open, onOpenChange],
  );

  const latest = stats?.latest;
  const latestAuthor = latest ? personName(latest.CreatedByName) : "";
  const latestText = latest ? stripNoteHtml(latest.Description) : "";
  const noteCount = stats?.total;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col justify-end bg-white">
      <div
        className={
          open && pane === "notes" ? "flex min-h-[156px] flex-1 border-b border-slate-100 bg-white" : "hidden"
        }
      >
        <NotesPanel entityId={entityId} module={module} onStatsChange={setStats} />
      </div>
      {open && pane === "terms" ? (
        <div className="flex min-h-[156px] flex-1 border-b border-slate-100 bg-white">
          <QuoteTermsPanel quoteId={entityId} />
        </div>
      ) : null}
      {open && pane === "actions" ? (
        <div className="flex min-h-[156px] flex-1 items-center justify-center border-b border-slate-100 bg-white px-4 text-sm text-slate-500">
          Actions will appear here.
        </div>
      ) : null}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => show("notes")}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${
            open && pane === "notes"
              ? "bg-[#086fb8] font-semibold text-white"
              : "bg-sky-50 font-semibold text-[#086fb8] hover:bg-sky-100"
          }`}
          aria-expanded={open && pane === "notes"}
        >
          <Icon name="sticky_note_2" size={16} filled />
          <span>Notes</span>
          <span
            className={`min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-semibold tabular-nums ${
              open && pane === "notes" ? "bg-white/20 text-white" : "bg-white text-[#086fb8]"
            }`}
          >
            {noteCount == null ? "…" : noteCount}
          </span>
        </button>
        {latest ? (
          <button
            type="button"
            onClick={() => show("notes")}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            title={latestText}
          >
            <Avatar src={latest.ProfileImage} name={latestAuthor} size={22} />
            <span className="max-w-[8.5rem] shrink-0 truncate text-[12px] font-semibold text-slate-800">
              {latestAuthor}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{latestText}</span>
            {stats && stats.pinned > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-amber-700">
                <Icon name="keep" size={12} filled />
                {stats.pinned}
              </span>
            ) : null}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => show("notes")}
            className="min-w-0 flex-1 truncate text-left text-[12px] text-slate-400 hover:text-slate-600"
          >
            Write a note
          </button>
        )}
        <button
          type="button"
          onClick={() => show("terms")}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[13px] ${
            open && pane === "terms" ? "bg-slate-100 font-medium text-slate-800" : "text-slate-500 hover:text-slate-800"
          }`}
          aria-expanded={open && pane === "terms"}
        >
          <IconLabel icon="gavel">Terms</IconLabel>
        </button>
        <button
          type="button"
          onClick={() => show("actions")}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[13px] ${
            open && pane === "actions" ? "bg-slate-100 font-medium text-slate-800" : "text-slate-500 hover:text-slate-800"
          }`}
          aria-expanded={open && pane === "actions"}
        >
          <IconLabel icon="event" count={0} size={16}>
            Actions
          </IconLabel>
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={open ? "Collapse dock" : "Expand dock"}
          aria-expanded={open}
        >
          <Icon name={open ? "expand_more" : "expand_less"} size={18} />
        </button>
      </div>
    </section>
  );
}
