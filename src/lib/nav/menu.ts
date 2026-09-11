import type { TebMenuApp, TebMenuItem, TebUserDetail } from "@/lib/api/types";
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

export function userIsAdmin(user: TebUserDetail | null): boolean {
  return user?.IsAdmin === 1 || user?.IsAdmin === true;
}

export function asMenuItems(items: unknown): TebMenuItem[] {
  return Array.isArray(items) ? (items as TebMenuItem[]) : [];
}

export function isHiddenItem(item: TebMenuItem): boolean {
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
export function permittedApps(menu: TebMenuApp[] | unknown, _user: TebUserDetail | null): TebMenuApp[] {
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

export function fuseIconToMaterial(icon?: string | null): string {
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

export function itemIconName(item: TebMenuItem): string {
  return fuseIconToMaterial(item.icon);
}

export function itemKey(item: TebMenuItem, fallback: string): string {
  return `${fallback}:${item.menucode || item.id || item.link || item.title || "item"}`;
}

export function isActionItem(item: TebMenuItem): boolean {
  if (item.type === "action") return true;
  const title = (item.title ?? "").trim();
  return /^add(\s|$)/i.test(title);
}

export function collectItemLinks(item: TebMenuItem): string[] {
  const links: string[] = [];
  if (item.link) links.push(normalizeAppPath(item.link));
  for (const child of visibleNavItems(item.children)) {
    links.push(...collectItemLinks(child));
  }
  return links;
}

export function collectAppLinks(app: TebMenuApp): string[] {
  const links: string[] = [];
  if (app.Url) links.push(normalizeAppPath(app.Url));
  for (const item of visibleNavItems(app.NavigationMenus)) {
    links.push(...collectItemLinks(item));
  }
  return [...new Set(links)].filter((link) => link !== "/");
}

export function firstItemLink(item: TebMenuItem): string | null {
  if (item.link) return normalizeAppPath(item.link);
  for (const child of visibleNavItems(item.children)) {
    const nested = firstItemLink(child);
    if (nested) return nested;
  }
  return null;
}

export function appLandingPath(app: TebMenuApp): string {
  const items = visibleNavItems(app.NavigationMenus);
  const dash = items.find((item) => item.menucode === "DASH");
  const defaultChild = dash?.children?.find((child) => child.isdefault === 1 || child.isdefault === true);
  if (defaultChild?.link) return normalizeAppPath(defaultChild.link);
  if (dash?.link) return normalizeAppPath(dash.link);
  for (const item of items) {
    const link = firstItemLink(item);
    if (link) return link;
  }
  if (app.Url) return normalizeAppPath(app.Url);
  return "/";
}

export function defaultPermittedLandingPath(
  user: TebUserDetail | null,
  menu: TebMenuApp[],
): string {
  const apps = permittedApps(menu, user);
  if (userIsAdmin(user)) {
    const admin = apps.find((app) => app.AppCode === "ADM");
    if (admin) return appLandingPath(admin);
  }
  const sales = apps.find((app) => app.AppCode === "SALES");
  const primary = sales ?? apps[0];
  return primary ? appLandingPath(primary) : "/";
}

function longestMatchingLink(links: string[], pathname: string): string | null {
  return (
    links
      .filter((link) => pathname === link || pathname.startsWith(`${link}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

export function appForPath(pathname: string, apps: TebMenuApp[]): TebMenuApp | null {
  const ranked = apps
    .map((app) => {
      const match = longestMatchingLink(collectAppLinks(app), pathname);
      return { app, score: match?.length ?? 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.app ?? apps[0] ?? null;
}

export function sectionMatchesPath(item: TebMenuItem, pathname: string): boolean {
  return longestMatchingLink(collectItemLinks(item).filter((link) => link !== "/"), pathname) != null;
}

export function linkMatchesPath(pathname: string, link?: string | null): boolean {
  const href = link ? normalizeAppPath(link) : "";
  if (!href || href === "/") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionForPath(pathname: string, app: TebMenuApp | null): TebMenuItem | null {
  if (!app) return null;
  const ranked = visibleNavItems(app.NavigationMenus)
    .map((item) => {
      const match = longestMatchingLink(collectItemLinks(item).filter((link) => link !== "/"), pathname);
      return { item, score: match?.length ?? 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.item ?? null;
}
