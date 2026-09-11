import {
  isQuoteId,
  loadQuoteView,
  rankQuoteMatches,
  searchQuotes,
  toQuoteCard,
  toQuoteView,
} from "@/lib/api/quote-view";
import { getSubscriberUserCurrency } from "@/lib/api/quote-lookups";
import { REPORT_ENTITIES } from "@/lib/chat/entities";
import type { QuoteCard, ReportIntent, ReportResult } from "@/lib/chat/types";
import { userFacingAskError } from "@/lib/chat/user-copy";
import { mappedCurrency } from "@/lib/money";

type EmptyResult = (
  partial: Omit<ReportResult, "analysis" | "charts" | "amount" | "metric" | "currencySymbol" | "currencyCode"> &
    Partial<Pick<ReportResult, "amount" | "metric" | "currencySymbol" | "currencyCode" | "quoteCards" | "quoteView">>,
) => ReportResult;

function needleOf(intent: ReportIntent): string {
  const fromCriteria = intent.criteria.find((row) => row.key === "quotecode")?.values[0];
  return (fromCriteria || intent.search || "").trim();
}

function suggestionsFor(cards: QuoteCard[]): string[] {
  const views = cards
    .slice(0, 3)
    .map((card) => (card.code ? `View quote ${card.code}` : `View quote ${card.title}`));
  return [...views, "Quotes created last 7 days", "What filters can I use on quotes?"];
}

function appliedOf(intent: ReportIntent): ReportResult["applied"] {
  return { filterId: null, filterValues: null, fullTextSearch: needleOf(intent) };
}

export async function runQuoteView(intent: ReportIntent, emptyResult: EmptyResult): Promise<ReportResult> {
  const entity = REPORT_ENTITIES.quote;
  const extraChips = ["view"];
  const needle = needleOf(intent);

  try {
    const preferred = await getSubscriberUserCurrency().catch(() => null);
    const currencySource = preferred?.extra ?? null;
    if (needle && isQuoteId(needle)) {
      const view = await loadQuoteView(needle, currencySource);
      if (view) {
        return emptyResult({
          text: `${view.code ? `${view.code} · ` : ""}${view.title}`,
          chips: [entity.plural, ...extraChips],
          total: 1,
          rows: [],
          columns: entity.columns,
          entity: "quote",
          stack: "list",
          quoteView: view,
          amount: 0,
          metric: "count",
          currencySymbol: view.currencySymbol,
          currencyCode: view.currencyCode,
          suggestions: ["Quotes created last 7 days", "What filters can I use on quotes?"],
          applied: appliedOf(intent),
        });
      }
    }

    const listed = await searchQuotes(needle, needle ? 25 : 8);
    const ranked = needle ? rankQuoteMatches(listed, needle) : listed;
    const rows = ranked.length > 0 ? ranked : listed;
    const currency = mappedCurrency(rows[0], currencySource);
    const cards = rows
      .slice(0, 8)
      .map((row) => toQuoteCard(row, currencySource))
      .filter((row): row is QuoteCard => Boolean(row));

    if (rows.length === 1) {
      const id = cards[0]?.id || String(rows[0].Id ?? "");
      const view = id ? await loadQuoteView(id, currencySource) : toQuoteView(rows[0], { preferredCurrency: currencySource });
      if (view) {
        return emptyResult({
          text: `${view.code ? `${view.code} · ` : ""}${view.title}`,
          chips: [entity.plural, ...extraChips],
          total: 1,
          rows: [rows[0]],
          columns: entity.columns,
          entity: "quote",
          stack: "list",
          quoteView: view,
          amount: 0,
          metric: "count",
          currencySymbol: view.currencySymbol,
          currencyCode: view.currencyCode,
          suggestions: ["Quotes created last 7 days", "What filters can I use on quotes?"],
          applied: appliedOf(intent),
        });
      }
    }

    if (cards.length === 0) {
      return emptyResult({
        text: needle
          ? `No quotes matched “${needle}”. Try the quote number, title, or company, or open the quote in TEB.`
          : "Tell me the quote number, title, or company to open.",
        chips: [entity.plural, "view"],
        total: 0,
        rows: [],
        columns: entity.columns,
        entity: "quote",
        stack: "list",
        suggestions: ["Quotes created last 7 days", "What filters can I use on quotes?"],
        applied: appliedOf(intent),
      });
    }

    return emptyResult({
      text: needle
        ? `${cards.length} quote${cards.length === 1 ? "" : "s"} matching “${needle}”. Pick one, or open it in TEB.`
        : "Which quote should I open?",
      chips: [entity.plural, "view"],
      total: cards.length,
      rows,
      columns: entity.columns,
      entity: "quote",
      stack: "list",
      quoteCards: cards,
      amount: 0,
      metric: "count",
      currencySymbol: currency.symbol,
      currencyCode: currency.code,
      suggestions: suggestionsFor(cards),
      applied: appliedOf(intent),
    });
  } catch (err) {
    return emptyResult({
      text: userFacingAskError(err),
      chips: [entity.plural, "view"],
      total: 0,
      rows: [],
      columns: entity.columns,
      entity: "quote",
      stack: "list",
      suggestions: ["Quotes created last 7 days", "What filters can I use on quotes?"],
      applied: appliedOf(intent),
    });
  }
}
