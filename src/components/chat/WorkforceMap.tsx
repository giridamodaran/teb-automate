"use client";

import { useMemo, useState } from "react";
import type { MapPath, MapPin } from "@/lib/chat/types";

const TILE = 256;
const WIDTH = 640;
const HEIGHT = 280;

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function lngToX(lng: number): number {
  return (lng + 180) / 360;
}

function wrapTile(value: number, zoom: number): number {
  const n = 2 ** zoom;
  return ((value % n) + n) % n;
}

function allPoints(pins: MapPin[], paths: MapPath[]): Array<{ lat: number; lng: number }> {
  return [...pins, ...paths.flatMap((path) => path.points)].filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
}

function fit(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number; zoom: number } {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  if (points.length === 1) return { ...center, zoom: 14 };
  const latSpan = Math.max(maxLat - minLat, 0.008);
  const lngSpan = Math.max(maxLng - minLng, 0.008);
  const pad = 0.2;
  let zoom = 15;
  for (let z = 15; z >= 3; z -= 1) {
    const world = TILE * 2 ** z;
    const width = Math.abs(lngToX(maxLng + lngSpan * pad) - lngToX(minLng - lngSpan * pad)) * world;
    const height = Math.abs(mercatorY(minLat - latSpan * pad) - mercatorY(maxLat + latSpan * pad)) * world;
    if (width <= WIDTH && height <= HEIGHT) {
      zoom = z;
      break;
    }
    zoom = z;
  }
  return { ...center, zoom };
}

function pinClass(kind: MapPin["kind"], active: boolean): string {
  if (kind === "start") {
    return active
      ? "block h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-600 shadow"
      : "block h-3 w-3 rounded-full border-2 border-white bg-emerald-500 shadow";
  }
  if (kind === "end") {
    return active
      ? "block h-3.5 w-3.5 rounded-full border-2 border-white bg-[#c2410c] shadow"
      : "block h-3 w-3 rounded-full border-2 border-white bg-[#ea580c] shadow";
  }
  return active
    ? "block h-3.5 w-3.5 rounded-full border-2 border-white bg-[#c2410c] shadow"
    : "block h-3 w-3 rounded-full border-2 border-white bg-[#086fb8] shadow";
}

export function WorkforceMap({
  pins,
  paths = [],
  title,
}: {
  pins: MapPin[];
  paths?: MapPath[];
  title?: string;
}) {
  const points = useMemo(() => allPoints(pins, paths), [pins, paths]);
  const view = useMemo(() => (points.length ? fit(points) : { lat: 20, lng: 0, zoom: 2 }), [points]);
  const [active, setActive] = useState<number | null>(pins.length === 1 ? 0 : null);

  const tiles = useMemo(() => {
    const world = TILE * 2 ** view.zoom;
    const cx = lngToX(view.lng) * world;
    const cy = mercatorY(view.lat) * world;
    const left = cx - WIDTH / 2;
    const top = cy - HEIGHT / 2;
    const startX = Math.floor(left / TILE);
    const startY = Math.floor(top / TILE);
    const endX = Math.floor((left + WIDTH) / TILE);
    const endY = Math.floor((top + HEIGHT) / TILE);
    const cells: Array<{ key: string; src: string; left: number; top: number }> = [];
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const tx = wrapTile(x, view.zoom);
        const ty = wrapTile(y, view.zoom);
        cells.push({
          key: `${view.zoom}-${tx}-${ty}-${x}-${y}`,
          src: `https://tile.openstreetmap.org/${view.zoom}/${tx}/${ty}.png`,
          left: x * TILE - left,
          top: y * TILE - top,
        });
      }
    }
    const markers = pins.map((pin, index) => ({
      index,
      pin,
      left: lngToX(pin.lng) * world - left,
      top: mercatorY(pin.lat) * world - top,
    }));
    const lines = paths.map((path, index) => ({
      index,
      dotted: path.dotted,
      d: path.points
        .map((point, pointIndex) => {
          const x = lngToX(point.lng) * world - left;
          const y = mercatorY(point.lat) * world - top;
          return `${pointIndex === 0 ? "M" : "L"}${x} ${y}`;
        })
        .join(" "),
    }));
    return { cells, markers, lines };
  }, [pins, paths, view]);

  if (points.length === 0) return null;

  const selected = active != null ? pins[active] : null;

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {title || (paths.length > 0 ? "Route" : "Last location")}
      </p>
      <div className="relative overflow-hidden bg-slate-200" style={{ height: HEIGHT }}>
        {tiles.cells.map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            className="absolute max-w-none"
            style={{ width: TILE, height: TILE, left: tile.left, top: tile.top }}
            draggable={false}
          />
        ))}
        {tiles.lines.length > 0 ? (
          <svg className="pointer-events-none absolute inset-0 z-[5]" width={WIDTH} height={HEIGHT}>
            {tiles.lines.map((line) => (
              <path
                key={line.index}
                d={line.d}
                fill="none"
                stroke={line.dotted ? "#dc2626" : "#086fb8"}
                strokeWidth={3}
                strokeDasharray={line.dotted ? "6 6" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        ) : null}
        {tiles.markers.map((marker) => (
          <button
            key={`${marker.pin.label}-${marker.index}`}
            type="button"
            className="absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: marker.left, top: marker.top }}
            onClick={() => setActive(marker.index)}
            title={marker.pin.label}
          >
            <span className={pinClass(marker.pin.kind, active === marker.index)} />
          </button>
        ))}
      </div>
      {selected ? (
        <p className="px-2 py-1.5 text-[12px] text-slate-700">
          <span className="font-medium">{selected.label}</span>
          {selected.subtitle ? ` — ${selected.subtitle}` : ""}
        </p>
      ) : (
        <p className="px-2 py-1.5 text-[11px] text-slate-500">
          {paths.length > 0 ? "Tap a pin for start, stop, or a checkpoint." : "Tap a pin to see who is there."}
        </p>
      )}
      <p className="px-2 pb-1 text-[10px] text-slate-400">© OpenStreetMap</p>
    </div>
  );
}
