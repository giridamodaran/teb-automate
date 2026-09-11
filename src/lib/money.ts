import { getCurrentUser, getJsonItem, getSetting, SESSION_KEYS, setJsonItem } from "@/lib/auth/session";

type CurrencySource = {
  id?: string;
  label?: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

/** API often stores INR as NativeSymbol/Text "Rs". Show the rupee sign instead. */
const ISO_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  AED: "د.إ",
  PKR: "₨",
};

function isoCodeFrom(row: Record<string, unknown>): string {
  for (const key of ["CurrencyCode", "IsoCode", "ISOCode"]) {
    const value = firstString(row, [key]);
    if (/^[A-Za-z]{3}$/.test(value)) return value.toUpperCase();
  }
  const code = firstString(row, ["Code"]);
  if (/^[A-Za-z]{3}$/.test(code)) return code.toUpperCase();
  const label = firstString(row, ["Text", "Name", "CurrencyName", "Label"]);
  const match = label.match(/\b([A-Za-z]{3})\b/);
  return match ? match[1].toUpperCase() : "";
}

function prettySymbol(raw: string, row?: Record<string, unknown> | null): string {
  const token = raw.trim();
  const code = row ? isoCodeFrom(row) : "";
  if (code && ISO_SYMBOLS[code]) return ISO_SYMBOLS[code];
  if (/^rs\.?$/i.test(token) || /^inr$/i.test(token)) return "₹";
  return token;
}

function symbolFromLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const inner = trimmed.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || "";
  const token = (inner.split(/[,\s]+/).filter(Boolean).pop() || inner || trimmed).trim();
  if (token && token.length <= 4) return token;
  return "";
}

function symbolFields(row: Record<string, unknown>): string {
  const direct = firstString(row, ["NativeSymbol", "CurrencySymbol", "CurrencyIcon", "Symbol"]);
  if (direct) return prettySymbol(direct, row);
  for (const key of ["Text", "Name", "CurrencyName", "Label", "SubText", "DisplayText"]) {
    const parsed = symbolFromLabel(firstString(row, [key]));
    if (parsed) return prettySymbol(parsed, row);
  }
  return "";
}

function asRecord(source: CurrencySource): Record<string, unknown> {
  if (typeof source.id === "string" && "label" in source) {
    return { ...(source.extra ?? {}), Id: source.id, CurrencyId: source.id, Label: source.label };
  }
  return source;
}

function currencyList(): Record<string, unknown>[] {
  const raw = getJsonItem<unknown>(SESSION_KEYS.currencyList);
  if (Array.isArray(raw)) return raw.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  return [];
}

function currencyRowById(id: string): Record<string, unknown> | null {
  if (!id) return null;
  return currencyList().find((row) => String(row.Id ?? row.id ?? "") === id) ?? null;
}

function symbolById(id: string): string {
  const match = currencyRowById(id);
  return match ? symbolFields(match) : "";
}

function isoCodeById(id: string): string {
  const match = currencyRowById(id);
  return match ? isoCodeFrom(match) : "";
}

function fromSourceOnly(source: Record<string, unknown> | CurrencySource): { symbol: string; code: string } {
  const row = asRecord(source);
  const currencyId = firstString(row, [
    "CurrencyId",
    "UserCurrencyId",
    "UserLocationCurrencyId",
    "SubscriberCurrencyId",
  ]);
  const looksLikeCurrency = Boolean(
    firstString(row, ["NativeSymbol", "CurrencySymbol", "CurrencyCode", "IsoCode", "ISOCode"]),
  );
  const id = currencyId || (looksLikeCurrency ? firstString(row, ["Id"]) : "");
  const label = firstString(row, ["Label"]);
  const symbol =
    symbolFields(row) ||
    symbolById(id) ||
    (label && label.length <= 4 ? prettySymbol(label, row) : "");
  const code = isoCodeFrom(row) || isoCodeById(id);
  return { symbol, code };
}

function settingRecord(): Record<string, unknown> | null {
  const setting = getSetting();
  if (!setting || typeof setting !== "object") return null;
  const nested = Array.isArray(setting.Currency) ? setting.Currency[0] : setting.Currency;
  if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  return setting as Record<string, unknown>;
}

function settingSymbol(): string {
  const nested = settingRecord();
  if (!nested) return "";
  const fromNested = symbolFields(nested);
  if (fromNested) return fromNested;
  return firstString(nested, ["NativeSymbol", "CurrencySymbol", "CurrencyIcon"]);
}

function settingCode(): string {
  const nested = settingRecord();
  return nested ? isoCodeFrom(nested) : "";
}

/** Live: list NativeSymbol → row CurrencySymbol → SETTING.Currency.NativeSymbol. */
export function currencySymbolFrom(
  source?: CurrencySource | Record<string, unknown> | null,
  header?: Record<string, unknown> | null,
): string {
  if (source) {
    const row = asRecord(source);
    const fromSource = symbolFields(row);
    if (fromSource) return fromSource;
    const fromList = symbolById(firstString(row, ["CurrencyId", "Id"]));
    if (fromList) return fromList;
    const label = firstString(row, ["Label"]);
    if (label && label.length <= 4) return prettySymbol(label, row);
  }
  if (header) {
    const fromHeader = symbolFields(header);
    if (fromHeader) return fromHeader;
    const fromHeaderList = symbolById(firstString(header, ["CurrencyId"]));
    if (fromHeaderList) return fromHeaderList;
  }
  return settingSymbol();
}

/** Quote UI order: record → CurrencyId list → mapped user currency → current user → SETTING.Currency. */
export function mappedCurrency(
  row?: Record<string, unknown> | null,
  preferred?: Record<string, unknown> | null,
): { symbol: string; code: string } {
  const user = getCurrentUser() as Record<string, unknown> | null;
  const sources = [row, preferred, user, settingRecord()].filter(Boolean) as Record<string, unknown>[];
  let symbol = "";
  let code = "";
  for (const source of sources) {
    const found = fromSourceOnly(source);
    if (!symbol && found.symbol) symbol = found.symbol;
    if (!code && found.code) code = found.code;
    if (symbol && code) break;
  }
  if (!symbol) symbol = settingSymbol();
  if (!code) code = settingCode();
  if (!code && symbol === "₹") code = "INR";
  if (!code && symbol === "$") code = "USD";
  return { symbol, code };
}

export function cacheCurrencyList(options: Array<{ extra?: Record<string, unknown> }>): void {
  const rows = options
    .map((option) => option.extra)
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  if (rows.length === 0) return;
  setJsonItem(SESSION_KEYS.currencyList, rows);
}

export function moneyDecimalPlaces(): number {
  const raw = Number(getCurrentUser()?.DecimalPlace);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 6) return raw;
  return 2;
}

export function formatAmount(value: number, symbol = ""): string {
  const digits = moneyDecimalPlaces();
  const number = (Number.isFinite(value) ? value : 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return symbol ? `${symbol} ${number}` : number;
}

/** Short labels for charts. Uses the mapped symbol — never a hardcoded $. */
export function formatCompactAmount(value: number, symbol = ""): string {
  const n = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(n);
  const body =
    abs >= 10_000_000
      ? `${(n / 10_000_000).toFixed(1)}Cr`
      : abs >= 100_000
        ? `${(n / 100_000).toFixed(1)}L`
        : abs >= 1000
          ? `${(n / 1000).toFixed(1)}k`
          : n.toFixed(n % 1 === 0 ? 0 : 1);
  return symbol ? `${symbol}${body}` : body;
}

export function isMoneyColumn(code: string, dataType?: string): boolean {
  if (/CURRENCYSYMBOL|CURRENCYICON/i.test(code)) return false;
  if (dataType === "NUMBER") return true;
  return /^(AMOUNT|NETAMOUNT|TOTALAMOUNT|GRANDTOTAL|SUBTOTAL|TOTAL|VALUE|UNITPRICE|PRICE|DISCOUNTAMOUNT)$/i.test(code);
}
