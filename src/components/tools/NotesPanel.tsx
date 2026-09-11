"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/lib/auth/AuthProvider";
import { userAvatarUrl, userDisplayName } from "@/lib/auth/session";
import { TebApiError } from "@/lib/api/types";
import {
  deleteNote,
  isPrivateNote,
  listNotes,
  personName,
  pinNote,
  saveNote,
  statsFromNotes,
  stripNoteHtml,
  type NotesContext,
  type NotesStats,
  type TebNote,
} from "@/lib/api/notes";

function formatCompactWhen(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const delta = Date.now() - parsed.getTime();
  if (delta < 45_000) return "now";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))}h`;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatFullWhen(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function notePhoto(note: TebNote, selfName: string, selfPic: string | null | undefined): string | undefined {
  if (note.ProfileImage) return note.ProfileImage;
  if (selfPic && personName(note.CreatedByName) === selfName) return selfPic;
  return undefined;
}

export function NotesPanel({
  entityId,
  module,
  onStatsChange,
}: NotesContext & { onStatsChange?: (stats: NotesStats) => void }) {
  const { user } = useAuth();
  const selfName = personName(userDisplayName(user));
  const selfPic = userAvatarUrl(user) && user?.ProfilePic ? String(user.ProfilePic) : undefined;
  const [notes, setNotes] = useState<TebNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [editingId, setEditingId] = useState("");

  const ctx: NotesContext = { entityId, module };
  const hasList = useRef(false);

  const refresh = useCallback(async () => {
    if (!entityId) return;
    if (!hasList.current) setLoading(true);
    setError("");
    try {
      const page = await listNotes(ctx);
      setNotes(page.notes);
      hasList.current = true;
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not load notes");
    } finally {
      setLoading(false);
    }
  }, [entityId, module]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    onStatsChange?.(statsFromNotes(notes));
  }, [notes, loading, onStatsChange]);

  function resetComposer() {
    setDraft("");
    setPinned(false);
    setIsPrivate(false);
    setEditingId("");
  }

  function startEdit(note: TebNote) {
    setDraft(stripNoteHtml(note.Description));
    setPinned(note.IsPin);
    setIsPrivate(isPrivateNote(note));
    setEditingId(note.Id);
  }

  async function submit() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await saveNote(ctx, {
        description: draft,
        isPin: pinned,
        isPrivate,
        notesId: editingId || undefined,
      });
      resetComposer();
      await refresh();
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(note: TebNote) {
    setBusyId(note.Id);
    setError("");
    try {
      await pinNote(note.Id);
      await refresh();
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not pin note");
    } finally {
      setBusyId("");
    }
  }

  async function remove(note: TebNote) {
    const preview = stripNoteHtml(note.Description).slice(0, 80);
    if (!window.confirm(preview ? `Delete this note?\n\n${preview}` : "Delete this note?")) {
      return;
    }
    setBusyId(note.Id);
    setError("");
    try {
      await deleteNote(note.Id);
      if (editingId === note.Id) resetComposer();
      await refresh();
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : "Could not delete note");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Avatar src={selfPic} name={selfName} size={24} />
        <textarea
          rows={editingId ? 2 : 1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={editingId ? "Update note" : "Write a note"}
          className="min-h-[32px] flex-1 resize-none rounded-full border-0 bg-white px-3 py-1.5 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#086fb8]/30"
        />
        <button
          type="button"
          onClick={() => setPinned((value) => !value)}
          className={`rounded-full p-1 ${pinned ? "text-amber-700" : "text-slate-400 hover:text-slate-600"}`}
          aria-pressed={pinned}
          title={pinned ? "Unpin" : "Pin"}
        >
          <Icon name="keep" size={16} filled={pinned} />
        </button>
        <button
          type="button"
          onClick={() => setIsPrivate((value) => !value)}
          className={`rounded-full p-1 ${isPrivate ? "text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
          aria-pressed={isPrivate}
          title={isPrivate ? "Private note" : "Anyone on this record can see this"}
        >
          <Icon name={isPrivate ? "lock" : "lock_open"} size={16} filled={isPrivate} />
        </button>
        {editingId ? (
          <button type="button" onClick={resetComposer} className="text-xs font-medium text-slate-500 hover:underline">
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={saving || !draft.trim()}
          className="inline-flex h-7 items-center rounded-full bg-[#086fb8] px-3 text-xs font-semibold text-white hover:bg-[#065a96] disabled:opacity-50"
        >
          {saving ? "…" : editingId ? "Save" : "Add"}
        </button>
      </form>

      {error ? <p className="border-b border-red-100 bg-red-50 px-3 py-1 text-xs text-red-700">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5">
        {loading ? (
          <p className="px-2 py-3 text-center text-sm text-slate-500">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-slate-500">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {notes.map((note) => {
              const text = stripNoteHtml(note.Description);
              const author = personName(note.CreatedByName);
              const busy = busyId === note.Id;
              const editing = editingId === note.Id;
              return (
                <li
                  key={note.Id}
                  className={`group flex h-8 items-center gap-2 rounded-md px-2 ${
                    note.IsPin ? "bg-amber-50" : "hover:bg-slate-50"
                  } ${editing ? "bg-sky-50" : ""}`}
                >
                  <Avatar src={notePhoto(note, selfName, selfPic)} name={author} size={22} />
                  <span className="max-w-[9rem] shrink-0 truncate text-[12px] font-semibold text-slate-800">
                    {author}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-[12px] leading-4 text-slate-600" title={text}>
                    {text || " "}
                  </p>
                  {isPrivateNote(note) ? (
                    <span className="text-slate-400" title="Private">
                      <Icon name="lock" size={12} />
                    </span>
                  ) : null}
                  {note.IsPin ? (
                    <span className="text-amber-700" title="Pinned">
                      <Icon name="keep" size={12} filled />
                    </span>
                  ) : null}
                  <time
                    className="shrink-0 text-[10px] tabular-nums text-slate-400"
                    dateTime={note.CreatedOn}
                    title={formatFullWhen(note.CreatedOn)}
                  >
                    {formatCompactWhen(note.CreatedOn)}
                  </time>
                  <div className="flex w-[4.25rem] shrink-0 items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded p-0.5 text-slate-400 hover:text-amber-700 disabled:opacity-50"
                      title={note.IsPin ? "Unpin" : "Pin"}
                      aria-label={note.IsPin ? "Unpin" : "Pin"}
                      onClick={() => void togglePin(note)}
                    >
                      <Icon name="keep" size={14} filled={note.IsPin} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded p-0.5 text-slate-400 hover:text-[#086fb8] disabled:opacity-50"
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => startEdit(note)}
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-50"
                      title="Delete"
                      aria-label="Delete"
                      onClick={() => void remove(note)}
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
