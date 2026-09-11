export interface TebApiEnvelope<T = unknown> {
  Data?: T;
  Value?: string;
  Succeeded?: boolean;
  StatusCode?: string | number;
  Messages?: string[];
  error?: string;
  message?: string;
  Message?: string;
  CorrelationId?: string;
  value?: unknown;
  TotalCount?: number;
}

export interface TebUserDetail {
  UserId?: string | number;
  IsAdmin?: number | boolean;
  Logo?: string | null;
  ProfilePic?: string | null;
  Name?: string;
  FirstName?: string;
  LastName?: string;
  UserName?: string;
  Email?: string;
  DecimalPlace?: number;
  [key: string]: unknown;
}

export interface TebLoginData {
  JWTToken?: string;
  UserDetail?: TebUserDetail;
  Token?: string;
  [key: string]: unknown;
}

export interface TebMenuItem {
  id?: string;
  menucode?: string;
  title?: string;
  icon?: string;
  link?: string;
  disabled?: number | boolean;
  hidden?: number | boolean;
  isdefault?: number | boolean;
  module?: string;
  groupapp?: string;
  type?: string;
  children?: TebMenuItem[];
  [key: string]: unknown;
}

export interface TebMenuApp {
  AppCode?: string;
  AppTitle?: string;
  Icon?: string;
  Url?: string;
  Description?: string;
  ModuleCode?: string;
  disabled?: number | boolean;
  NavigationMenus?: TebMenuItem[];
  [key: string]: unknown;
}

export interface TebSetting {
  AgmKey?: string | null;
  Favicon?: string | null;
  [key: string]: unknown;
}

export class TebApiError extends Error {
  readonly status: number;
  readonly correlationId?: string;
  readonly payload?: TebApiEnvelope;

  constructor(message: string, status: number, payload?: TebApiEnvelope) {
    super(message);
    this.name = "TebApiError";
    this.status = status;
    this.payload = payload;
    this.correlationId = payload?.CorrelationId;
  }
}
