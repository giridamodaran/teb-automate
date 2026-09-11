"use client";

import type { TebMenuApp } from "@/lib/api/types";
import { appIconName, appLandingPath } from "@/lib/nav/menu";
import { Icon } from "@/components/ui/Icon";

export function AppRail({
  apps,
  activeAppCode,
  collapsed,
  onSelectApp,
  onToggleCollapse,
}: {
  apps: TebMenuApp[];
  activeAppCode: string | null;
  collapsed: boolean;
  onSelectApp: (app: TebMenuApp) => void;
  onToggleCollapse: () => void;
}) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-white/10 transition-[width] duration-200"
      style={{
        width: collapsed ? 72 : 240,
        background: "linear-gradient(180deg, #111827, #1e293b)",
      }}
    >
      <div className={`flex h-14 shrink-0 items-center gap-3 px-3 ${collapsed ? "justify-center" : ""}`}>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white shadow-sm"
          style={{ background: "linear-gradient(135deg, #086fb8, #6366f1)" }}
        >
          <Icon name="hub" size={18} />
        </div>
        {!collapsed ? <span className="truncate text-sm font-semibold tracking-tight text-white">TEB Cloud</span> : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1" aria-label="Applications">
        {apps.length === 0 ? (
          <p className="px-2 py-3 text-xs text-white/70">No apps were returned for this user.</p>
        ) : (
          apps.map((app, index) => {
            const code = String(app.AppCode || app.AppTitle || index);
            const active = code === activeAppCode;
            const landing = appLandingPath(app);
            const label = app.AppTitle || code;
            return (
              <button
                key={`${code}-${index}`}
                type="button"
                title={label}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                onClick={() => onSelectApp(app)}
                className={`flex w-full items-center rounded-lg border-0 text-left transition ${
                  collapsed ? "flex-col justify-center gap-0.5 px-1 py-2" : "gap-3 px-3 py-2.5"
                }`}
                style={{
                  background: active ? "rgba(255,255,255,0.1)" : "transparent",
                  color: active ? "#ffffff" : "rgba(255,255,255,0.72)",
                }}
              >
                <Icon
                  name={appIconName(app)}
                  size={22}
                  className="leading-none"
                  style={{ color: active ? "#38bdf8" : "inherit" }}
                />
                {!collapsed ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                    <Icon name="chevron_right" size={18} className="opacity-50" />
                  </>
                ) : (
                  <span className="max-w-full truncate text-[9px] leading-tight text-white/80">{label}</span>
                )}
                <span className="sr-only">{landing}</span>
              </button>
            );
          })
        )}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white ${
            collapsed ? "justify-center px-2" : ""
          }`}
          aria-label={collapsed ? "Expand app list" : "Collapse app list"}
        >
          <Icon name={collapsed ? "chevron_right" : "chevron_left"} size={20} />
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </aside>
  );
}
