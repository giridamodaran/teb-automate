export type TebHostKey =
  | "MASTER"
  | "COMPANY"
  | "USER"
  | "DYNAMIC"
  | "TEMPLATE"
  | "WEBCONNECT"
  | "MICRO";

const DEFAULT_HOSTS: Record<TebHostKey, string> = {
  MASTER: "https://mastersv4api.tebsys.com",
  COMPANY: "https://companyv4api.tebsys.com",
  USER: "https://userv4api.tebsys.com",
  DYNAMIC: "https://dynamicv4api.tebsys.com",
  TEMPLATE: "https://templatev4api.tebsys.com",
  WEBCONNECT: "https://webconnectorv4api.tebsys.com/api",
  MICRO: "https://gateway.tebsys.com",
};

function envOrDefault(envValue: string | undefined, fallback: string): string {
  const value = envValue?.trim() || fallback;
  return value.replace(/\/+$/, "");
}

export function getTebHosts(): Record<TebHostKey, string> {
  return {
    MASTER: envOrDefault(process.env.NEXT_PUBLIC_TEB_MASTER_API, DEFAULT_HOSTS.MASTER),
    COMPANY: envOrDefault(process.env.NEXT_PUBLIC_TEB_COMPANY_API, DEFAULT_HOSTS.COMPANY),
    USER: envOrDefault(process.env.NEXT_PUBLIC_TEB_USER_API, DEFAULT_HOSTS.USER),
    DYNAMIC: envOrDefault(process.env.NEXT_PUBLIC_TEB_DYNAMIC_API, DEFAULT_HOSTS.DYNAMIC),
    TEMPLATE: envOrDefault(process.env.NEXT_PUBLIC_TEB_TEMPLATE_API, DEFAULT_HOSTS.TEMPLATE),
    WEBCONNECT: envOrDefault(
      process.env.NEXT_PUBLIC_TEB_WEBCONNECT_API,
      DEFAULT_HOSTS.WEBCONNECT,
    ),
    MICRO: envOrDefault(process.env.NEXT_PUBLIC_TEB_MICRO_API, DEFAULT_HOSTS.MICRO),
  };
}

const BROWSER_PROXY: Partial<Record<TebHostKey, string>> = {
  MASTER: "/teb-api/master",
  USER: "/teb-api/user",
  DYNAMIC: "/teb-api/dynamic",
  COMPANY: "/teb-api/company",
  TEMPLATE: "/teb-api/template",
  MICRO: "/teb-api/micro",
};

export function tebUrl(host: TebHostKey, path: string): string {
  const suffix = path.replace(/^\/+/, "");
  if (typeof window !== "undefined" && BROWSER_PROXY[host]) {
    return `${BROWSER_PROXY[host]}/${suffix}`;
  }
  const base = getTebHosts()[host];
  return `${base}/${suffix}`;
}

export const AUTH_PATHS = {
  login: "gateway/admin/GetLogin",
  refreshToken: "gateway/admin/RefreshToken",
  menuDetail: "gateway/menu/GetMenuDetail",
  pinnedMenu: "gateway/common/UserConfiguration/GetCustomizeMenu",
  logout: "AcLogout",
  forgotPassword: "AcUserForgotPassword",
  resetPassword: "AcUserResetPassword",
  verifyEmail: "AcVerifiedEmail",
  formDetail: "FnGetFormDetail()",
  subscriberSetting: "FnGetSubscriberSetting()?$expand=Currency",
  subscriberUsers: "FnGetSubscriberUsers()",
  subscriberId: "FnGetSubscriberId()",
  menus: "FnGetMenuDetail()",
} as const;
