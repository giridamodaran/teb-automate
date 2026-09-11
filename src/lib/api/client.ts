import { AUTH_PATHS, tebUrl, type TebHostKey } from "@/lib/api/hosts";
import { TebApiError, type TebApiEnvelope } from "@/lib/api/types";
import {
  clearSession,
  getAccessToken,
  isTokenExpired,
  setAccessToken,
} from "@/lib/auth/session";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  skipRefresh?: boolean;
  timeoutMs?: number;
}

let cachedIp = "";
let ipPromise: Promise<string> | null = null;
let refreshPromise: Promise<string | null> | null = null;

export async function getDeviceAddress(): Promise<string> {
  if (cachedIp) return cachedIp;
  if (ipPromise) return ipPromise;
  ipPromise = Promise.race([
    fetch("https://jsonip.com/")
      .then(async (res) => {
        const data = (await res.json()) as { ip?: string };
        return data.ip ?? "";
      })
      .catch(() => ""),
    new Promise<string>((resolve) => setTimeout(() => resolve(""), 2000)),
  ])
    .then((ip) => {
      cachedIp = ip;
      return cachedIp;
    })
    .finally(() => {
      ipPromise = null;
    });
  return ipPromise;
}

function deviceInfo(): string {
  if (typeof navigator === "undefined") {
    return JSON.stringify({ BrowserName: "unknown", browserVersion: "unknown" });
  }
  const ua = navigator.userAgent;
  let name = "unknown";
  let version = "unknown";
  if (ua.includes("Edg/")) {
    name = "edge";
    version = ua.split("Edg/")[1]?.split(" ")[0] ?? "unknown";
  } else if (ua.includes("Chrome/")) {
    name = "chrome";
    version = ua.split("Chrome/")[1]?.split(" ")[0] ?? "unknown";
  } else if (ua.includes("Safari/") && ua.includes("Version/")) {
    name = "safari";
    version = ua.split("Version/")[1]?.split(" ")[0] ?? "unknown";
  } else if (ua.includes("Firefox/")) {
    name = "firefox";
    version = ua.split("Firefox/")[1]?.split(" ")[0] ?? "unknown";
  }
  return JSON.stringify({ BrowserName: name, browserVersion: version });
}

async function buildHeaders(auth: boolean, hasBody: boolean): Promise<Headers> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (hasBody) headers.set("Content-Type", "application/json");
  headers.set("Type", "WEB");
  headers.set("DeviceInfo", deviceInfo());
  headers.set("DeviceAddress", await getDeviceAddress());
  headers.set("ApiHitDate", new Date().toString());
  if (auth) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isAuthSkipUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("getlogin") ||
    lower.includes("refreshtoken") ||
    lower.includes("aclogout") ||
    lower.includes("acuserforgotpassword")
  );
}

async function parseBody(res: Response): Promise<TebApiEnvelope | string | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as TebApiEnvelope;
  } catch {
    return text;
  }
}

function envelopeMessage(payload: TebApiEnvelope | string | null, fallback: string): string {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload || fallback;
  if (payload.error) return payload.error;
  if (payload.message) return payload.message;
  if (payload.Message) return payload.Message;
  if (Array.isArray(payload.Messages) && payload.Messages.length > 0) {
    return payload.Messages[0];
  }
  if (typeof payload.Data === "string" && payload.Data.trim()) return payload.Data;
  return fallback;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const url = tebUrl("MICRO", AUTH_PATHS.refreshToken);
    const headers = await buildHeaders(true, false);
    const res = await fetch(url, {
      method: "GET",
      headers,
      credentials: "include",
    });
    const payload = await parseBody(res);
    if (!res.ok || typeof payload === "string" || !payload) {
      return null;
    }
    const token =
      (payload.Data as { Token?: string } | undefined)?.Token ??
      (payload as TebApiEnvelope<{ Token?: string }>).Data?.Token;
    if (!token) return null;
    setAccessToken(token);
    return token;
  })()
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function tebRequest<T>(
  host: TebHostKey,
  path: string,
  options: RequestOptions = {},
): Promise<TebApiEnvelope<T>> {
  const method = options.method ?? (options.body ? "POST" : "GET");
  const auth = options.auth ?? true;
  const url = tebUrl(host, path);

  if (auth && !options.skipRefresh) {
    const token = getAccessToken();
    if (token && isTokenExpired(token) && !isAuthSkipUrl(url)) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        clearSession();
        throw new TebApiError("Session expired", 401);
      }
    }
  }

  const headers = await buildHeaders(auth, options.body !== undefined);
  if (url.startsWith("/teb-api/")) {
    const token = getAccessToken();
    if (token) headers.set("X-Teb-Authorization", `Bearer ${token}`);
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: abortAfter(options.timeoutMs ?? (options.body !== undefined ? 20000 : 8000)),
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    if (aborted) throw new TebApiError("Request timed out", 408);
    const message = err instanceof Error ? err.message : "Network error";
    throw new TebApiError(
      message === "Failed to fetch" ? "Could not reach TEB. Check the network connection." : message,
      0,
    );
  }

  const payload = await parseBody(res);

  if (res.status === 401 && auth && !options.skipRefresh && !isAuthSkipUrl(url)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return tebRequest<T>(host, path, { ...options, skipRefresh: true });
    }
    clearSession();
    throw new TebApiError("Session expired", 401, typeof payload === "object" ? payload ?? undefined : undefined);
  }

  if (res.status === 403) {
    throw new TebApiError("Forbidden", 403, typeof payload === "object" ? payload ?? undefined : undefined);
  }

  if (!res.ok) {
    throw new TebApiError(
      envelopeMessage(payload, `Request failed (${res.status})`),
      res.status,
      typeof payload === "object" ? payload ?? undefined : undefined,
    );
  }

  if (typeof payload === "string") {
    return { Data: payload as T };
  }

  return (payload ?? {}) as TebApiEnvelope<T>;
}
