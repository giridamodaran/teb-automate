import { tebRequest } from "@/lib/api/client";
import { acAddDetail } from "@/lib/api/quote";
import { TebApiError, type TebApiEnvelope } from "@/lib/api/types";

/** Shared Notes module (Quote, Lead, Order, …). Not Quote-specific. */
export const NOTES_MODULE = "Notes";
export const NOTES_CODE = "MANAGE";

/**
 * Live stores notes under the app code (`TEBQuote`), not the Dynamic module
 * (`EstimationManagement`). The old View notes list filters `ModuleCodes` to
 * these ids, so saving as EstimationManagement is invisible there.
 */
const NOTES_APP_BY_MODULE: Record<string, string> = {
  EstimationManagement: "TEBQuote",
  LeadManagement: "TEBLead",
  SalesManagement: "TEBSale",
  OrderManagement: "TEBOrder",
  InvoiceManagement: "TEBInvoice",
  TicketManagement: "TEBTicket",
  ActionManagement: "TEBAction",
  BusinessContactManagement: "TEBBusiness",
  WorkOrderManagement: "TEBWorkorder",
  WorkorderManagement: "TEBWorkorder",
  WorkForceManagement: "TEBWorkforce",
  WorkForeceManagement: "TEBWorkforce",
  ProductsManagement: "TEBAsset",
};

/** App id the notes store and live ModuleCodes filter use (`TEBQuote`, …). */
export function notesAppModule(module: string): string {
  const value = (module || "").trim();
  if (!value) return value;
  if (/^TEB/i.test(value)) return value;
  return NOTES_APP_BY_MODULE[value] || value;
}

export const NOTES_ACTION = {
  add: "ADD",
  delete: "DELETE",
  pin: "PINNOTE",
} as const;

export interface NotesContext {
  entityId: string;
  module: string;
}

export interface TebNote {
  Id: string;
  Description: string;
  IsPin: boolean;
  Type: string;
  NoteType: string;
  CreatedByName: string;
  CreatedOn: string;
  Module?: string;
  ProfileImage?: string;
}

function envelopeFailed(envelope: TebApiEnvelope, fallback: string): void {
  if (envelope.Succeeded !== false) return;
  const message =
    Array.isArray(envelope.Messages) && envelope.Messages[0]
      ? envelope.Messages[0]
      : envelope.error || envelope.message || envelope.Message || fallback;
  throw new TebApiError(message, 400, envelope);
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return asRecords(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function truthyPin(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function pictureFromRow(row: Record<string, unknown>): string | undefined {
  const raw = row.ProfileImage ?? row.profileImage ?? row.Img ?? row.img ?? row.Image;
  const value = raw == null ? "" : String(raw).trim();
  return value || undefined;
}

function mapNote(row: Record<string, unknown>): TebNote {
  return {
    Id: String(row.Id ?? row.id ?? ""),
    Description: String(row.Description ?? row.Notes ?? row.description ?? row.notes ?? ""),
    IsPin: truthyPin(row.IsPin ?? row.isPin),
    Type: String(row.Type ?? row.type ?? ""),
    NoteType: String(row.NoteType ?? row.noteType ?? ""),
    CreatedByName: String(row.CreatedByName ?? row.createdByName ?? row.CreatedBy ?? ""),
    CreatedOn: String(row.CreatedOn ?? row.createdOn ?? row.CreatedDate ?? row.createdDate ?? ""),
    Module: row.Module != null ? String(row.Module) : undefined,
    ProfileImage: pictureFromRow(row),
  };
}

function notesFromEnvelope(envelope: TebApiEnvelope): { notes: TebNote[]; total: number } {
  const data = envelope.Data;
  let rows: Record<string, unknown>[] = [];
  let total = envelope.TotalCount;

  if (Array.isArray(data)) {
    rows = asRecords(data);
  } else if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    rows = asRecords(nested.Data ?? nested.Notes ?? nested.value ?? nested.Value);
    if (typeof nested.TotalCount === "number") total = nested.TotalCount;
  } else {
    rows = asRecords(envelope.value ?? envelope.Value);
  }

  const notes = rows.map(mapNote).filter((note) => note.Id);
  notes.sort((a, b) => {
    if (a.IsPin !== b.IsPin) return a.IsPin ? -1 : 1;
    return String(b.CreatedOn).localeCompare(String(a.CreatedOn));
  });
  return { notes, total: typeof total === "number" ? total : notes.length };
}

export function stripNoteHtml(html: string): string {
  if (!html) return "";
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  if (typeof window === "undefined") {
    return withoutTags.replace(/\s+/g, " ").trim();
  }
  const parsed = new DOMParser().parseFromString(withoutTags, "text/html");
  return (parsed.documentElement.textContent || "").replace(/\s+/g, " ").trim();
}

export function isPrivateNote(note: Pick<TebNote, "Type">): boolean {
  return note.Type === "Private";
}

export interface NotesStats {
  total: number;
  pinned: number;
  snippet: string;
  latest?: TebNote;
}

/** API names are often `FirstName /role` (e.g. `Name of Employee /person`). */
export function personName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Someone";
  const parts = trimmed
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const skip = new Set(["person", "user", "employee"]);
  const meaningful = parts.filter((part) => !skip.has(part.toLowerCase()));
  return meaningful[0] || parts[0] || trimmed;
}

export function statsFromNotes(notes: TebNote[]): NotesStats {
  const pinnedNotes = notes.filter((note) => note.IsPin);
  const latest = pinnedNotes[0] ?? notes[0];
  const text = latest ? stripNoteHtml(latest.Description) : "";
  return {
    total: notes.length,
    pinned: pinnedNotes.length,
    snippet: text.length > 72 ? `${text.slice(0, 72).trim()}…` : text,
    latest,
  };
}

/**
 * Related app codes (`TEBQuote`, `TEBLead`, …). Live’s manage-notes filter uses these;
 * posting them as `ModuleCodes` on `GetSubscriberNotes` currently returns no rows,
 * so the composer list omits that field.
 */
export async function listNoteAppIds(module: string): Promise<Array<string | number>> {
  try {
    const envelope = await tebRequest<Array<{ Id?: string | number; id?: string | number }>>(
      "MICRO",
      `gateway/admin/getnotesapps?Module=${encodeURIComponent(module)}`,
      { method: "GET" },
    );
    envelopeFailed(envelope, "Could not load note apps");
    const rows = asRecords(envelope.Data ?? envelope.value ?? envelope.Value);
    return rows
      .map((row) => row.Id ?? row.id)
      .filter((id): id is string | number => id != null && id !== "");
  } catch {
    return [];
  }
}

export async function listNotes(
  ctx: NotesContext,
  page: { pageNumber?: number; pageSize?: number } = {},
): Promise<{ notes: TebNote[]; total: number }> {
  const envelope = await tebRequest("MICRO", "gateway/common/GetSubscriberNotes", {
    method: "POST",
    body: {
      Data: {
        EntityId: ctx.entityId,
        Module: ctx.module,
      },
      PageNumber: page.pageNumber ?? 0,
      PageSize: page.pageSize ?? 50,
    },
  });
  envelopeFailed(envelope, "Could not load notes");
  return notesFromEnvelope(envelope);
}

export interface SaveNoteInput {
  description: string;
  isPin?: boolean;
  isPrivate?: boolean;
  notesId?: string;
}

export async function saveNote(ctx: NotesContext, input: SaveNoteInput): Promise<void> {
  const description = input.description.trim();
  if (!description) {
    throw new TebApiError("Enter a note", 400);
  }
  const envelope = await acAddDetail({
    Module: NOTES_MODULE,
    Code: NOTES_CODE,
    PrimaryKey: "",
    Data: JSON.stringify({
      ModuleId: ctx.entityId,
      Module: notesAppModule(ctx.module),
      Type: input.isPrivate ? "Private" : "",
      Description: description,
      NoteType: "RTB",
      NotesId: input.notesId || "",
      IsPin: Boolean(input.isPin),
    }),
    Action: NOTES_ACTION.add,
  });
  envelopeFailed(envelope, "Could not save note");
}

export async function deleteNote(noteId: string): Promise<void> {
  const envelope = await acAddDetail({
    Module: NOTES_MODULE,
    Code: NOTES_CODE,
    PrimaryKey: noteId,
    Data: "",
    Action: NOTES_ACTION.delete,
  });
  envelopeFailed(envelope, "Could not delete note");
}

export async function pinNote(noteId: string): Promise<void> {
  const envelope = await acAddDetail({
    Module: NOTES_MODULE,
    Code: NOTES_CODE,
    PrimaryKey: noteId,
    Data: "",
    Action: NOTES_ACTION.pin,
  });
  envelopeFailed(envelope, "Could not pin note");
}
