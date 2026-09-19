import { getTebHosts } from "@/lib/api/hosts";
import { type TebLoginData } from "@/lib/api/types";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;
let loginPromise: Promise<string> | null = null;

export function getAutomationCredentials() {
  const email = process.env.TEB_AUTOMATION_EMAIL || process.env.TEB_ASK_EMAIL;
  const password = process.env.TEB_AUTOMATION_PASSWORD || process.env.TEB_ASK_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Missing TEB automation credentials. Please set TEB_AUTOMATION_EMAIL and TEB_AUTOMATION_PASSWORD environment variables."
    );
  }

  return { email, password };
}

function parseJwtExpiry(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return Date.now() + 3600 * 1000;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    if (payload.exp) {
      return payload.exp * 1000;
    }
  } catch {
    // Fallback to 1 hour if parsing fails
  }
  return Date.now() + 3600 * 1000;
}

export async function getAutomationToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) {
    return cachedToken.token;
  }

  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = (async () => {
    const { email, password } = getAutomationCredentials();
    const microHost = getTebHosts().MICRO;
    const loginUrl = `${microHost}/gateway/admin/GetLogin`;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Type: "WEB",
      DeviceInfo: JSON.stringify({ BrowserName: "AutomationEngine", browserVersion: "1.0.0" }),
      DeviceAddress: "127.0.0.1",
      ApiHitDate: new Date().toString(),
    };

    const res = await fetch(loginUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ UserName: email, Password: password }),
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`TEB login failed (${res.status}): ${errorText}`);
    }

    const payload = (await res.json()) as {
      StatusCode?: number | string;
      Succeeded?: boolean;
      Messages?: string[];
      Data?: TebLoginData;
    };

    if (String(payload.StatusCode) === "401" || payload.Succeeded === false || !payload.Data?.JWTToken) {
      const errMsg = payload.Messages?.[0] || "Invalid TEB username or password";
      throw new Error(`TEB login rejected: ${errMsg}`);
    }

    const token = payload.Data.JWTToken;
    const expiresAt = parseJwtExpiry(token);

    cachedToken = { token, expiresAt };
    return token;
  })().finally(() => {
    loginPromise = null;
  });

  return loginPromise;
}
