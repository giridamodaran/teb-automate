import { AUTH_PATHS } from "@/lib/api/hosts";
import { tebRequest } from "@/lib/api/client";
import { TebApiError, type TebLoginData, type TebMenuApp, type TebUserDetail } from "@/lib/api/types";
import { persistBootstrap, persistLoginSession, getCurrentUser, unwrapMenuList, sessionUserId } from "@/lib/auth/session";

export interface LoginInput {
  UserName: string;
  Password: string;
}

export async function login(input: LoginInput): Promise<TebLoginData> {
  const envelope = await tebRequest<TebLoginData>("MICRO", AUTH_PATHS.login, {
    method: "POST",
    body: input,
    auth: false,
    skipRefresh: true,
  });

  if (String(envelope.StatusCode) === "401" || envelope.Succeeded === false) {
    throw new TebApiError(
      envelope.Messages?.[0] || envelope.error || "Incorrect username or password",
      401,
      envelope,
    );
  }

  const data = envelope.Data;
  const token = data?.JWTToken;
  const user = data?.UserDetail;
  if (!token || !user) {
    throw new TebApiError("Login succeeded without a session payload", 500, envelope);
  }

  persistLoginSession(token, user);
  return data;
}

export async function logout(): Promise<void> {
  const user = getCurrentUser();
  const id = sessionUserId(user);
  if (id) {
    try {
      await tebRequest("USER", AUTH_PATHS.logout, {
        method: "POST",
        body: { loginDetail: { Id: id } },
        skipRefresh: true,
      });
    } catch {
      // Live app still clears local storage if logout API fails.
    }
  }
}

export async function forgotPassword(email: string, origin: string, ipAddress: string): Promise<void> {
  await tebRequest("USER", AUTH_PATHS.forgotPassword, {
    method: "POST",
    body: {
      forgetDetail: {
        Email: email,
        IpAddress: ipAddress,
        Url: origin,
      },
    },
    auth: false,
    skipRefresh: true,
  });
}

export async function bootstrapSession(): Promise<{
  menu: TebMenuApp[];
  user: TebUserDetail | null;
}> {
  const [menuResult, formResult, usersResult, settingResult, pinnedResult] = await Promise.allSettled([
    tebRequest<TebMenuApp[]>("MICRO", AUTH_PATHS.menuDetail, { timeoutMs: 30000 }),
    tebRequest("COMPANY", AUTH_PATHS.formDetail),
    tebRequest("USER", AUTH_PATHS.subscriberUsers),
    tebRequest("COMPANY", AUTH_PATHS.subscriberSetting),
    tebRequest("MICRO", AUTH_PATHS.pinnedMenu),
  ]);

  const menuEnvelope = menuResult.status === "fulfilled" ? menuResult.value : null;
  const menu = unwrapMenuList(menuEnvelope?.Data ?? menuEnvelope?.value ?? menuEnvelope);

  persistBootstrap({
    menu: menu.length ? menu : undefined,
    setting:
      settingResult.status === "fulfilled"
        ? (settingResult.value.Data ?? settingResult.value)
        : {},
    screenDetail:
      formResult.status === "fulfilled"
        ? (formResult.value.value ?? formResult.value.Data ?? formResult.value)
        : undefined,
    subscriberUsers:
      usersResult.status === "fulfilled"
        ? (usersResult.value.value ?? usersResult.value.Data ?? usersResult.value)
        : undefined,
    pinnedMenu:
      pinnedResult.status === "fulfilled"
        ? (pinnedResult.value.Data ?? pinnedResult.value)
        : undefined,
  });

  return { menu, user: getCurrentUser() };
}
