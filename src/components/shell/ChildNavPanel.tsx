"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TebMenuItem } from "@/lib/api/types";
import { normalizeAppPath } from "@/lib/auth/session";
import {
  firstItemLink,
  isActionItem,
  itemIconName,
  itemKey,
  linkMatchesPath,
  sectionMatchesPath,
  visibleNavItems,
} from "@/lib/nav/menu";
import { Icon } from "@/components/ui/Icon";

function navClass(active: boolean, extra = "") {
  return `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm no-underline transition ${
    active ? "bg-sky-50 font-semibold text-[#086fb8]" : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
  } ${extra}`;
}

function ChildLink({
  item,
  pathname,
  nested = false,
}: {
  item: TebMenuItem;
  pathname: string;
  nested?: boolean;
}) {
  const href = item.link ? normalizeAppPath(item.link) : firstItemLink(item);
  if (!href) return null;
  const active = linkMatchesPath(pathname, href);
  return (
    <Link href={href} className={navClass(active, nested ? "pl-5" : "")}>
      {!nested && item.icon ? <Icon name={itemIconName(item)} size={18} /> : null}
      <span className="truncate">{item.title || item.menucode || "Untitled"}</span>
    </Link>
  );
}

function NavGroup({ item, pathname, fallbackKey }: { item: TebMenuItem; pathname: string; fallbackKey: string }) {
  const children = visibleNavItems(item.children);
  const matches = sectionMatchesPath(item, pathname);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (matches) setOpen(true);
  }, [matches]);

  return (
    <div className="mt-1">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          {item.title || item.menucode}
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={16} className="text-slate-400" />
      </button>
      {open
        ? children.map((child, index) => (
            <ChildNavNode
              key={itemKey(child, `${fallbackKey}-${index}`)}
              item={child}
              pathname={pathname}
              fallbackKey={`${fallbackKey}-${index}`}
              nested
              depth={1}
            />
          ))
        : null}
    </div>
  );
}

function ChildNavNode({
  item,
  pathname,
  fallbackKey,
  nested = false,
  depth = 0,
}: {
  item: TebMenuItem;
  pathname: string;
  fallbackKey: string;
  nested?: boolean;
  depth?: number;
}) {
  const children = depth > 8 ? [] : visibleNavItems(item.children);

  if (children.length > 0) {
    if (nested) {
      return (
        <div className="mt-1">
          <p className="px-5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            {item.title || item.menucode}
          </p>
          {children.map((child, index) => (
            <ChildNavNode
              key={itemKey(child, `${fallbackKey}-${index}`)}
              item={child}
              pathname={pathname}
              fallbackKey={`${fallbackKey}-${index}`}
              nested
              depth={depth + 1}
            />
          ))}
        </div>
      );
    }
    return <NavGroup item={item} pathname={pathname} fallbackKey={fallbackKey} />;
  }

  if (isActionItem(item) && item.link) {
    return (
      <Link
        href={normalizeAppPath(item.link)}
        className="mb-1 flex items-center justify-center gap-2 rounded-lg bg-[#086fb8] px-3 py-2.5 text-sm font-semibold text-white no-underline hover:bg-[#065a96]"
      >
        <Icon name={item.icon ? itemIconName(item) : "add"} size={18} />
        <span>{item.title || "Add"}</span>
      </Link>
    );
  }

  return <ChildLink item={item} pathname={pathname} nested={nested} />;
}

export function ChildNavPanel({
  title,
  items,
  pathname,
  onClose,
}: {
  title: string;
  items: TebMenuItem[];
  pathname: string;
  onClose: () => void;
}) {
  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white shadow-[8px_0_32px_rgba(15,23,42,0.08)]" aria-label={`${title} menu`}>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close section menu"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="px-2 text-sm text-slate-500">No sections in this app.</p>
        ) : (
          items.map((item, index) => (
            <ChildNavNode
              key={itemKey(item, `section-${index}`)}
              item={item}
              pathname={pathname}
              fallbackKey={`section-${index}`}
            />
          ))
        )}
      </nav>
    </aside>
  );
}
