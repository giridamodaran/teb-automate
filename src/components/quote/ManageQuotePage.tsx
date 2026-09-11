"use client";

import { statusFromQuote, type TebQuoteHeader } from "@/lib/api/quote";
import { ManageGrid } from "@/components/grid/ManageGrid";
import { QUOTE_DEFAULT_COLUMN_CODES, QUOTE_GRID_CONTEXT, QUOTE_LIST_ACTION, QUOTE_LIST_MODULE, QUOTE_MANAGE_COLUMNS } from "@/lib/grid/quote-manage";
import type { GridColumnDef } from "@/lib/grid/types";

function quoteCellValue(row: Record<string, unknown>, column: GridColumnDef): unknown {
  if (column.code === "STATUS" || column.property === "Status") {
    return statusFromQuote(row as TebQuoteHeader);
  }
  if (column.primary || column.property === "QuoteTitle" || column.code === "TITLE" || column.property === "Title") {
    return row.QuoteTitle || row.Title || row.QuoteCode || "";
  }
  return undefined;
}

export function ManageQuotePage() {
  return (
    <ManageGrid
      title="Manage Quote"
      listModule={QUOTE_LIST_MODULE}
      listAction={QUOTE_LIST_ACTION}
      listCode={QUOTE_LIST_ACTION}
      viewContext={QUOTE_GRID_CONTEXT}
      catalog={QUOTE_MANAGE_COLUMNS}
      fallbackCodes={QUOTE_DEFAULT_COLUMN_CODES}
      addHref="/sales/quote/addquote"
      addLabel="Add quote"
      rowHref={(row) => {
        const id = String(row.Id ?? "");
        return id ? `/sales/quote/view/${id}` : null;
      }}
      getCellValue={quoteCellValue}
    />
  );
}
