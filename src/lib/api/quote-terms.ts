import { tebRequest } from "@/lib/api/client";
import { asLookupOptions, type LookupOption } from "@/lib/api/quote-lookups";
import { QUOTE_MODULE } from "@/lib/api/quote";
import { TebApiError, type TebApiEnvelope } from "@/lib/api/types";

export interface QuoteTerm {
  Id: string;
  TermTitle: string;
  TermTypeId: string;
  TermType: string;
  TermText: string;
  Sequence?: number;
}

export interface QuoteTermSet {
  Id: string;
  TermSetName: string;
  MasterTermSetId: string;
  EntityTermDetail: QuoteTerm[];
}

function envelopeFailed(envelope: TebApiEnvelope, fallback: string): void {
  if (envelope.Succeeded === false) {
    throw new TebApiError(
      (Array.isArray(envelope.Messages) && envelope.Messages[0]) || envelope.error || envelope.message || fallback,
      400,
      envelope,
    );
  }
  if (typeof envelope.Data === "string" && /please update your application/i.test(envelope.Data)) {
    throw new TebApiError(envelope.Data, 400, envelope);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function termFromRow(row: Record<string, unknown>): QuoteTerm | null {
  const id = asText(row.Id ?? row.TermId);
  const title = asText(row.TermTitle ?? row.Title ?? row.Name);
  if (!id && !title) return null;
  return {
    Id: id,
    TermTitle: title || "Term",
    TermTypeId: asText(row.TermTypeId ?? row.TermType ?? row.TypeId),
    TermType: asText(row.TermTypeName ?? row.TermType ?? row.Type),
    TermText: asText(row.TermText ?? row.Text ?? row.Description ?? row.Terms),
    Sequence: Number(row.Sequence ?? row.SequenceNo ?? 0) || undefined,
  };
}

function termSetFromRow(row: Record<string, unknown>): QuoteTermSet {
  const detailsRaw = row.EntityTermDetail ?? row.TermDetail ?? row.Terms;
  const details = Array.isArray(detailsRaw) ? detailsRaw : [];
  const terms = details
    .map((item) => (item && typeof item === "object" ? termFromRow(item as Record<string, unknown>) : null))
    .filter((item): item is QuoteTerm => item != null);
  return {
    Id: asText(row.Id ?? row.TermSetId),
    TermSetName: asText(row.TermSetName ?? row.Name ?? row.Title) || "Terms",
    MasterTermSetId: asText(row.MasterTermSetId ?? row.TermSetId),
    EntityTermDetail: terms,
  };
}

export async function listQuoteTermTypes(): Promise<LookupOption[]> {
  const envelope = await tebRequest("MICRO", "gateway/common/GetSubscriberMasterContentDropDown", {
    method: "POST",
    body: { MasterCode: "TERMTYPE", startWith: "" },
  });
  envelopeFailed(envelope, "Could not load term types.");
  return asLookupOptions(envelope.Data ?? envelope.value ?? envelope.Value);
}

export async function listQuoteTerms(quoteId: string): Promise<QuoteTermSet[]> {
  const attempts = [
    { Module: QUOTE_MODULE.estimation, ModuleId: quoteId },
    { Module: "TEBQuote", ModuleId: quoteId },
  ];
  let lastError: unknown = null;
  for (const body of attempts) {
    try {
      const envelope = await tebRequest("MICRO", "gateway/term/getentitytermdetailbymoduleid", {
        method: "POST",
        body,
      });
      envelopeFailed(envelope, "Could not load terms.");
      const rows = envelope.Data ?? envelope.value ?? envelope.Value;
      const list = Array.isArray(rows) ? rows : [];
      return list
        .map((row) => asRecord(row))
        .filter((row): row is Record<string, unknown> => row != null)
        .map(termSetFromRow);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new TebApiError("Could not load terms.", 400);
}

export async function saveQuoteTerm(input: {
  quoteId: string;
  setId?: string;
  masterTermSetId?: string;
  termId?: string;
  title: string;
  typeId: string;
  text: string;
}): Promise<void> {
  const body = {
    Id: input.setId || null,
    MasterTermSetId: input.masterTermSetId || null,
    Module: QUOTE_MODULE.estimation,
    EntityId: input.quoteId,
    EntityTermDetail: [
      {
        Id: input.termId || null,
        TermTitle: input.title,
        TermTypeId: input.typeId,
        TermText: input.text,
      },
    ],
  };
  const envelope = await tebRequest("MICRO", "gateway/term/saveentitytermdetail", {
    method: "POST",
    body,
  });
  envelopeFailed(envelope, "Could not save the term.");
}

export async function deleteQuoteTerm(setId: string, termId: string): Promise<void> {
  const envelope = await tebRequest("MICRO", "gateway/term/deleteentityterm", {
    method: "DELETE",
    body: { Id: setId, TermId: termId },
  });
  envelopeFailed(envelope, "Could not delete the term.");
}
