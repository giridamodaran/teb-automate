"use client";

import type { ChartSeries } from "@/lib/chat/types";
import { formatCompactAmount } from "@/lib/money";

const PALETTE = ["#086fb8", "#0f766e", "#c2410c", "#7c3aed", "#b45309", "#0369a1", "#be123c", "#365314"];

function labelValue(value: number, symbol?: string): string {
  return symbol ? formatCompactAmount(value, symbol) : String(Math.round(value) === value ? value : Number(value.toFixed(1)));
}

function maxValue(points: Array<{ value: number }>): number {
  return Math.max(1, ...points.map((point) => point.value));
}

function BarChart({ series }: { series: ChartSeries }) {
  const width = 320;
  const height = 140;
  const max = maxValue(series.points);
  const gap = 8;
  const barW = Math.max(8, (width - gap * (series.points.length + 1)) / series.points.length);
  return (
    <svg viewBox={`0 0 ${width} ${height + 28}`} className="h-40 w-full" role="img" aria-label={series.title}>
      {series.points.map((point, index) => {
        const h = (point.value / max) * height;
        const x = gap + index * (barW + gap);
        const y = height - h;
        return (
          <g key={point.label}>
            <rect x={x} y={y} width={barW} height={h} fill={PALETTE[index % PALETTE.length]} />
            <text x={x + barW / 2} y={height + 12} textAnchor="middle" className="fill-slate-500" fontSize="8">
              {point.label.length > 8 ? `${point.label.slice(0, 7)}…` : point.label}
            </text>
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="fill-slate-700" fontSize="9">
              {labelValue(point.value, series.currencySymbol)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({ series }: { series: ChartSeries }) {
  const total = series.points.reduce((sum, point) => sum + point.value, 0) || 1;
  const cx = 70;
  const cy = 70;
  const r = 58;
  let angle = -Math.PI / 2;
  const slices = series.points.map((point, index) => {
    const slice = (point.value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + slice;
    angle = end;
    const large = slice > Math.PI ? 1 : 0;
    const path = [
      `M ${cx} ${cy}`,
      `L ${cx + r * Math.cos(start)} ${cy + r * Math.sin(start)}`,
      `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)}`,
      "Z",
    ].join(" ");
    return { path, color: PALETTE[index % PALETTE.length], label: point.label, value: point.value };
  });
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={series.title}>
        {slices.map((slice) => (
          <path key={slice.label} d={slice.path} fill={slice.color} />
        ))}
      </svg>
      <ul className="min-w-0 space-y-1 text-[11px] text-slate-600">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: slice.color }} />
            <span className="truncate">
              {slice.label} ({labelValue(slice.value, series.currencySymbol)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ series }: { series: ChartSeries }) {
  const width = 320;
  const height = 140;
  const max = maxValue(series.points);
  const pad = 16;
  const innerW = width - pad * 2;
  const innerH = height - pad;
  const coords = series.points.map((point, index) => {
    const x = pad + (series.points.length === 1 ? innerW / 2 : (index / (series.points.length - 1)) * innerW);
    const y = pad + innerH - (point.value / max) * innerH;
    return { x, y, ...point };
  });
  const polyline = coords.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height + 20}`} className="h-40 w-full" role="img" aria-label={series.title}>
      <polyline fill="none" stroke="#086fb8" strokeWidth="2" points={polyline} />
      {coords.map((point) => (
        <g key={point.label}>
          <circle cx={point.x} cy={point.y} r="3" fill="#086fb8" />
          <text x={point.x} y={height + 14} textAnchor="middle" className="fill-slate-500" fontSize="8">
            {point.label.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ReportCharts({ charts }: { charts?: ChartSeries[] }) {
  if (!charts?.length) return null;
  return (
    <div className="mt-3 space-y-3">
      {charts.map((series) => (
        <div key={`${series.kind}-${series.title}`} className="rounded-md border border-slate-200 bg-white p-2">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{series.title}</p>
          {series.kind === "pie" ? <PieChart series={series} /> : null}
          {series.kind === "bar" ? <BarChart series={series} /> : null}
          {series.kind === "line" ? <LineChart series={series} /> : null}
        </div>
      ))}
    </div>
  );
}
