"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { refreshAccessToken } from "@/lib/api/client";
import { bootstrapSession, login as apiLogin, logout as apiLogout } from "@/lib/api/auth";
import {
  clearSession,
  getAccessToken,
  getCurrentUser,
  getMenu,
  hasRequiredSessionKeys,
  isTokenExpired,
  persistLoginSession,
  SESSION_KEYS,
  userDisplayName,
} from "@/lib/auth/session";
import type { TebMenuApp, TebUserDetail } from "@/lib/api/types";

const PUBLIC_PATHS = ["/sign-in", "/forgot-password"];
const ASK_HOME = "/";

interface AuthContextValue {
  ready: boolean;
  user: TebUserDetail | null;
  menu: TebMenuApp[];
  displayName: string;
  signIn: (email: string, password: string, rememberEmail: boolean) => Promise<string>;
  signOut: () => Promise<void>;
  rememberedEmail: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<TebUserDetail | null>(null);
  const [menu, setMenu] = useState<TebMenuApp[]>([]);
  const [rememberedEmail, setRememberedEmail] = useState("");

  const hydrate = useCallback(async () => {
    const token = getAccessToken();
    const current = getCurrentUser();
    const storedMenu = getMenu();
    setRememberedEmail(localStorage.getItem(SESSION_KEYS.rememberedEmail) ?? "");

    if (!token) {
      setUser(null);
      setMenu([]);
      return false;
    }

    if (isTokenExpired(token)) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        clearSession();
        setUser(null);
        setMenu([]);
        return false;
      }
    }

    if (!hasRequiredSessionKeys()) {
      try {
        const boot = await bootstrapSession();
        setUser(boot.user ?? current);
        setMenu(Array.isArray(boot.menu) ? boot.menu : []);
        return boot.menu.length > 0 || Boolean(getAccessToken());
      } catch {
        setUser(current);
        setMenu(Array.isArray(storedMenu) ? storedMenu : []);
        return Boolean(getAccessToken());
      }
    }

    setUser(current);
    setMenu(Array.isArray(storedMenu) ? storedMenu : []);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrate();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  useEffect(() => {
    if (!ready || !user || menu.length > 0) return;
    let cancelled = false;
    void bootstrapSession()
      .then((boot) => {
        if (!cancelled && boot.menu.length) setMenu(boot.menu);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready, user, menu.length]);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token && !isPublicPath(pathname)) {
      router.replace("/sign-in");
      return;
    }
    if (token && user && (isPublicPath(pathname) || pathname !== ASK_HOME)) {
      router.replace(ASK_HOME);
    }
  }, [ready, pathname, router, user]);

  const signIn = useCallback(
    async (email: string, password: string, rememberEmail: boolean) => {
      const data = await apiLogin({ UserName: email, Password: password });
      persistLoginSession(data.JWTToken!, data.UserDetail!);
      if (rememberEmail) {
        localStorage.setItem(SESSION_KEYS.rememberedEmail, email);
        setRememberedEmail(email);
      } else {
        localStorage.removeItem(SESSION_KEYS.rememberedEmail);
        setRememberedEmail("");
      }
      let nextUser = data.UserDetail ?? null;
      let nextMenu: TebMenuApp[] = [];
      try {
        const boot = await bootstrapSession();
        nextUser = boot.user ?? nextUser;
        nextMenu = Array.isArray(boot.menu) ? boot.menu : [];
      } catch {
        nextMenu = getMenu();
      }
      setUser(nextUser);
      setMenu(nextMenu);
      localStorage.removeItem(SESSION_KEYS.loginClick);
      return ASK_HOME;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    clearSession();
    setUser(null);
    setMenu([]);
    router.replace("/sign-in");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      menu,
      displayName: userDisplayName(user),
      signIn,
      signOut,
      rememberedEmail,
    }),
    [ready, user, menu, signIn, signOut, rememberedEmail],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
