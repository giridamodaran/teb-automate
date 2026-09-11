"use client";

import { formatAmount } from "@/lib/money";

export function QuoteTotalsPanel({
  symbol,
  subtotal,
  discount,
  tax,
  taxLines = [],
  roundOff = 0,
  total,
  expanded = true,
}: {
  symbol: string;
  subtotal: number;
  discount: number;
  tax: number;
  taxLines?: Array<{ id?: string; label: string; amount: number }>;
  roundOff?: number;
  total: number;
  expanded?: boolean;
}) {
  const money = (value: number) => formatAmount(value, symbol);

  return (
    <aside
      className={`flex w-[16.5rem] shrink-0 flex-col border-l border-slate-200 bg-white ${
        expanded ? "justify-end px-4 py-2.5" : "h-10 justify-center px-4"
      }`}
      aria-label="Quote totals"
    >
      {expanded ? (
        <dl className="space-y-1 text-[13px]">
          <TotalsRow label="Subtotal" value={money(subtotal)} />
          <TotalsRow
            label="Discount"
            value={discount > 0 ? `− ${money(discount)}` : money(0)}
            muted={discount <= 0}
          />
          <TotalsRow label="Tax" value={money(tax)} muted={tax === 0} />
          {taxLines.map((line) => (
            <TotalsRow key={line.id ?? line.label} label={line.label} value={money(line.amount)} nested />
          ))}
          <TotalsRow
            label="Round off"
            value={roundOff < 0 ? `− ${money(Math.abs(roundOff))}` : money(roundOff)}
            muted={roundOff === 0}
          />
          <div className="!mt-1.5 border-t border-slate-200 pt-1.5">
            <TotalsRow label="Total" value={money(total)} strong />
          </div>
        </dl>
      ) : (
        <p className="text-right text-sm font-semibold tabular-nums text-slate-900">Total {money(total)}</p>
      )}
    </aside>
  );
}

function TotalsRow({
  label,
  value,
  nested,
  strong,
  muted,
}: {
  label: string;
  value: string;
  nested?: boolean;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${nested ? "pl-3 text-[11px]" : ""}`}>
      <dt className={strong ? "font-semibold text-slate-900" : muted ? "text-slate-400" : "text-slate-500"}>
        {label}
      </dt>
      <dd
        className={`tabular-nums ${
          strong ? "text-sm font-semibold text-slate-900" : muted ? "text-slate-400" : "text-slate-800"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
