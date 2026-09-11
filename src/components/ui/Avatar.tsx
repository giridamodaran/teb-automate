"use client";

import { useState } from "react";

const TONES = [
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-indigo-100 text-indigo-800",
];

function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word && !/^(of|the|and|a)$/i.test(word));
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  const compact = (words[0] || name).replace(/[^A-Za-z0-9]/g, "");
  return (compact.slice(0, 2) || "?").toUpperCase();
}

function tone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash + name.charCodeAt(i) * (i + 1)) % TONES.length;
  return TONES[hash] ?? TONES[0];
}

export function Avatar({
  src,
  name,
  size = 24,
}: {
  src?: string;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  const label = initials(name);

  if (showImage) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-1 ring-black/5"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tracking-wide ring-1 ring-black/5 ${tone(name)}`}
      style={{ width: size, height: size, fontSize: size < 24 ? 9 : 10 }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}
