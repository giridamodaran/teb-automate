import type { CSSProperties, ReactNode } from "react";

/** Single outlined icon family for the app (Material Symbols). */
export function Icon({
  name,
  size = 18,
  filled = false,
  className,
  style,
}: {
  name: string;
  size?: number;
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`material-symbols-outlined leading-none ${className ?? ""}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        ...style,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

/** Toolbar / rail control: icon plus a short label (and optional count). */
export function IconLabel({
  icon,
  children,
  count,
  filled,
  size = 18,
}: {
  icon: string;
  children?: ReactNode;
  count?: number | string;
  filled?: boolean;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={icon} size={size} filled={filled} />
      {children ? <span>{children}</span> : null}
      {count != null && count !== "" ? <span className="tabular-nums">{count}</span> : null}
    </span>
  );
}
