import type { TebMenuApp, TebMenuItem } from "@/lib/api/types";
import { isTruthyDisabled, normalizeAppPath, unwrapMenuList } from "@/lib/auth/session";

/** Not a real product app — live UI uses this for "customize sidebar". */
const EXCLUDED_APP_CODES = new Set(["CUSTOMSIDEBAR"]);

const APP_ICON_BY_CODE: Record<string, string> = {
  SALES: "storefront",
  SERVICE: "build",
  FINANCE: "account_balance",
  MARKETING: "campaign",
  WFORCE: "groups",
  ADM: "settings",
  LOC: "location_on",
  RPT: "bar_chart",
};

const FUSE_ICON_TO_MATERIAL: Record<string, string> = {
  "chart-pie": "pie_chart",
  "office-building": "apartment",
  "shopping-cart": "shopping_cart",
  "clipboard-check": "assignment_turned_in",
  "document-report": "description",
  "speakerphone": "campaign",
  "view-grid": "grid_view",
  "view-boards": "view_kanban",
  "collection": "layers",
  "cog": "settings",
  "users": "group",
  "user": "person",
  "user-group": "groups",
  "plus": "add",
  "plus-circle": "add_circle",
  "home": "home",
  "calendar": "calendar_month",
  "light-bulb": "lightbulb",
  "ticket": "confirmation_number",
  "cash": "payments",
  "currency-dollar": "attach_money",
  "chart-bar": "bar_chart",
  "map": "map",
  "location-marker": "location_on",
  "phone": "call",
  "mail": "mail",
  "briefcase": "work",
  "truck": "local_shipping",
  "cube": "inventory_2",
  "clipboard-list": "list_alt",
  "document-text": "article",
  "support": "support_agent",
};

function asMenuItems(items: unknown): TebMenuItem[] {
  return Array.isArray(items) ? (items as TebMenuItem[]) : [];
}

function isHiddenItem(item: TebMenuItem): boolean {
  return isTruthyDisabled(item.disabled);
}

export function visibleNavItems(items: TebMenuItem[] | unknown): TebMenuItem[] {
  return asMenuItems(items)
    .filter((item) => item && typeof item === "object" && !isHiddenItem(item))
    .map((item) => ({
      ...item,
      children: visibleNavItems(item.children),
    }));
}

function asMenuApps(menu: TebMenuApp[] | unknown): TebMenuApp[] {
  return unwrapMenuList(menu);
}

function appRecord(app: TebMenuApp): Record<string, unknown> {
  return app as TebMenuApp & Record<string, unknown>;
}

function appCodeOf(app: TebMenuApp): string {
  const rec = appRecord(app);
  return String(app.AppCode || rec.appCode || rec.Appcode || "").trim();
}

function appTitleOf(app: TebMenuApp): string {
  const rec = appRecord(app);
  return String(app.AppTitle || rec.appTitle || rec.Title || rec.title || "").trim();
}

function appMenusOf(app: TebMenuApp): TebMenuItem[] | unknown {
  const rec = appRecord(app);
  return app.NavigationMenus ?? rec.navigationMenus ?? rec.Menus ?? rec.menus;
}

/**
 * Apps the current user may open. GetMenuDetail is already permission-filtered
 * by the backend; we only drop the customize-sidebar editor entry.
 */
export function permittedApps(menu: TebMenuApp[] | unknown): TebMenuApp[] {
  return asMenuApps(menu)
    .filter((app) => {
      if (!app || typeof app !== "object") return false;
      const code = appCodeOf(app);
      if (EXCLUDED_APP_CODES.has(code.toUpperCase())) return false;
      if (isTruthyDisabled(app.disabled) || isTruthyDisabled(appRecord(app).Disabled)) return false;
      return Boolean(code || appTitleOf(app));
    })
    .map((app) => ({
      ...app,
      AppCode: appCodeOf(app) || app.AppCode,
      AppTitle: appTitleOf(app) || app.AppTitle,
      NavigationMenus: visibleNavItems(appMenusOf(app)),
    }));
}

function fuseIconToMaterial(icon?: string | null): string {
  if (!icon) return "circle";
  const raw = icon.includes(":") ? (icon.split(":").pop() ?? "") : icon;
  const slug = raw.trim().replace(/_/g, "-").toLowerCase();
  if (!slug) return "circle";
  if (FUSE_ICON_TO_MATERIAL[slug]) return FUSE_ICON_TO_MATERIAL[slug];
  return slug.replace(/-/g, "_");
}

export function appIconName(app: TebMenuApp): string {
  const code = app.AppCode ?? "";
  if (APP_ICON_BY_CODE[code]) return APP_ICON_BY_CODE[code];
  return fuseIconToMaterial(app.Icon) === "circle" ? "apps" : fuseIconToMaterial(app.Icon);
}

export function collectItemLinks(item: TebMenuItem): string[] {
  const links: string[] = [];
  if (item.link) links.push(normalizeAppPath(item.link));
  for (const child of visibleNavItems(item.children)) {
    links.push(...collectItemLinks(child));
  }
  return links;
}
