import type { TebMenuApp, TebSetting, TebUserDetail } from "@/lib/api/types";

export const SESSION_KEYS = {
  accessToken: "accessToken",
  currentUser: "CURRENTUSER",
  menu: "MENU",
  setting: "SETTING",
  screenDetail: "SCREENDETAIL",
  subscriberUser: "SUBSCRIBERUSER",
  pinnedMenu: "PINNEDMENU",
  currencyList: "CURRENCYLIST",
  agmKey: "TEBAgmKey",
  loginClick: "loginclick",
  rememberedEmail: "teb-remember-email",
  sidebarCollapsed: "teb-sidebar-collapsed",
  askJourney: "teb.ask.journey",
} as const;

const REQUIRED_KEYS = [
  SESSION_KEYS.accessToken,
  SESSION_KEYS.currentUser,
  SESSION_KEYS.menu,
  SESSION_KEYS.setting,
] as const;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function getAccessToken(): string {
  if (!canUseStorage()) return "";
  return localStorage.getItem(SESSION_KEYS.accessToken) ?? "";
}

export function setAccessToken(token: string): void {
  if (!canUseStorage()) return;
  localStorage.setItem(SESSION_KEYS.accessToken, token);
}

export function getJsonItem<T>(key: string): T | null {
  if (!canUseStorage()) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJsonItem(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  if (value === undefined || value === null) {
    localStorage.removeItem(key);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // SCREENDETAIL and similar payloads can exceed localStorage quota; skip rather than fail sign-in.
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  }
}

export function getCurrentUser(): TebUserDetail | null {
  return getJsonItem<TebUserDetail>(SESSION_KEYS.currentUser);
}

export function unwrapMenuList(raw: unknown, depth = 0): TebMenuApp[] {
  if (depth > 8 || raw == null) return [];
  if (typeof raw === "string") {
    try {
      return unwrapMenuList(JSON.parse(raw), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    const apps = raw.filter(looksLikeMenuApp) as TebMenuApp[];
    if (apps.length) return apps;
    for (const item of raw) {
      const nested = unwrapMenuList(item, depth + 1);
      if (nested.length) return nested;
    }
    return [];
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["Data", "data", "value", "Value", "Apps", "apps", "Menus", "Menu", "menu", "result", "Result"]) {
      if (obj[key] == null) continue;
      const nested = unwrapMenuList(obj[key], depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

function looksLikeMenuApp(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const obj = row as Record<string, unknown>;
  return Boolean(obj.AppCode || obj.appCode || obj.AppTitle || obj.appTitle || obj.NavigationMenus || obj.navigationMenus);
}

export function getMenu(): TebMenuApp[] {
  return unwrapMenuList(getJsonItem<unknown>(SESSION_KEYS.menu));
}

export function getSetting(): TebSetting | null {
  return getJsonItem<TebSetting>(SESSION_KEYS.setting);
}

export function getSubscriberUsers(): unknown {
  return getJsonItem(SESSION_KEYS.subscriberUser);
}

export function persistLoginSession(token: string, user: TebUserDetail): void {
  setAccessToken(token);
  setJsonItem(SESSION_KEYS.currentUser, user);
  localStorage.setItem(SESSION_KEYS.loginClick, "true");
}

export function persistBootstrap(payload: {
  menu?: TebMenuApp[];
  setting?: TebSetting | unknown;
  screenDetail?: unknown;
  subscriberUsers?: unknown;
  pinnedMenu?: unknown;
}): void {
  if (payload.menu !== undefined) setJsonItem(SESSION_KEYS.menu, payload.menu);
  if (payload.setting !== undefined) {
    setJsonItem(SESSION_KEYS.setting, payload.setting);
    const setting = payload.setting as TebSetting;
    if (setting && typeof setting === "object" && "AgmKey" in setting) {
      if (setting.AgmKey) {
        localStorage.setItem(SESSION_KEYS.agmKey, String(setting.AgmKey));
      } else {
        localStorage.removeItem(SESSION_KEYS.agmKey);
      }
    }
  }
  if (payload.screenDetail !== undefined) {
    setJsonItem(SESSION_KEYS.screenDetail, payload.screenDetail);
  }
  if (payload.subscriberUsers !== undefined) {
    setJsonItem(SESSION_KEYS.subscriberUser, payload.subscriberUsers);
  }
  if (payload.pinnedMenu !== undefined) {
    setJsonItem(SESSION_KEYS.pinnedMenu, payload.pinnedMenu);
  }
}

export function sessionUserId(user?: TebUserDetail | null): string {
  if (!user) return "";
  const row = user as Record<string, unknown>;
  for (const key of ["UserId", "userId", "UserID", "Id", "id"]) {
    const value = row[key];
    if (value == null || value === "") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  const fallback = user.UserName || user.Email;
  return fallback ? String(fallback).trim() : "";
}

export function askJourneyStorageKey(userId?: string | number | null): string {
  const id = userId == null ? "" : String(userId).trim();
  return id ? `${SESSION_KEYS.askJourney}.${id}` : SESSION_KEYS.askJourney;
}

export function snapshotAskJourneys(): Array<[string, string]> {
  if (!canUseStorage()) return [];
  const rows: Array<[string, string]> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(SESSION_KEYS.askJourney)) continue;
    const value = localStorage.getItem(key);
    if (value) rows.push([key, value]);
  }
  return rows;
}

export function clearSession(): void {
  if (!canUseStorage()) return;
  const remembered = localStorage.getItem(SESSION_KEYS.rememberedEmail);
  const collapsed = localStorage.getItem(SESSION_KEYS.sidebarCollapsed);
  const journeys = snapshotAskJourneys();
  localStorage.clear();
  if (remembered) localStorage.setItem(SESSION_KEYS.rememberedEmail, remembered);
  if (collapsed) localStorage.setItem(SESSION_KEYS.sidebarCollapsed, collapsed);
  for (const [key, value] of journeys) localStorage.setItem(key, value);
  sessionStorage.removeItem(SESSION_KEYS.askJourney);
}

export function hasRequiredSessionKeys(): boolean {
  if (!canUseStorage()) return false;
  return REQUIRED_KEYS.every((key) => Boolean(localStorage.getItem(key)));
}

export function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as { exp?: number };
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return !token;
  return payload.exp * 1000 < Date.now() + skewSeconds * 1000;
}

export function userDisplayName(user: TebUserDetail | null): string {
  if (!user) return "User";
  const combined = [user.FirstName, user.LastName].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  if (user.Name) return String(user.Name);
  if (user.UserName) return String(user.UserName);
  if (user.Email) return String(user.Email);
  return "User";
}

export function userAvatarUrl(user: TebUserDetail | null): string | null {
  if (!user) return null;
  const pic = user.ProfilePic || user.Logo;
  return pic ? String(pic) : null;
}

export function normalizeAppPath(link?: string | null): string {
  if (!link) return "/";
  const trimmed = link.trim();
  if (!trimmed) return "/";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function defaultLandingPath(user: TebUserDetail | null, menu: TebMenuApp[]): string {
  if (user?.IsAdmin === 1 || user?.IsAdmin === true) {
    return "/admin/system";
  }
  const sales = menu.find((app) => app.AppCode === "SALES");
  const dash = sales?.NavigationMenus?.find((item) => item.menucode === "DASH");
  const defaultChild = dash?.children?.find((child) => child.isdefault === 1 || child.isdefault === true);
  return normalizeAppPath(defaultChild?.link || dash?.link || "/");
}

export function isTruthyDisabled(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}
