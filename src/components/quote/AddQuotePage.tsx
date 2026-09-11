"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { currencySymbolFrom, formatAmount } from "@/lib/money";
import {
  archiveQuote,
  changeQuoteStatus,
  copyQuote,
  defaultQuoteViewPermissions,
  deleteQuote,
  emptyQuoteViewPermissions,
  getQuoteDefaults,
  getQuoteDetail,
  getQuoteDetailForEdit,
  loadQuoteViewPermissions,
  quoteViewPermissionsFrom,
  QUOTE_ACTION,
  QUOTE_MODULE,
  reviseQuote,
  saveQuoteHeader,
  statusFromQuote,
  statusesFromQuote,
  type QuoteViewPermissions,
  type TebQuoteHeader,
} from "@/lib/api/quote";
import { TebApiError } from "@/lib/api/types";
import {
  applyQuoteItemTax,
  removeQuoteItemTax,
  taxesFromItemRow,
  clampDiscount,
  clampQuantity,
  currencyFromSession,
  discountAmount,
  discountTypeLabel,
  getItemDefaults,
  itemCaptionDetails,
  itemDefaultsFromRecord,
  mergeItemExtra,
  getSubscriberUserCurrency,
  isCatalogDiscount,
  lineNet,
  listCurrencies,
  listDiscountCatalog,
  listDiscountTypes,
  listLocations,
  listOwners,
  listQuoteStatuses,
  listQuoteTaxes,
  listQuoteTypes,
  listWorkflows,
  loadQuoteItems,
  loadQuoteModuleFlags,
  lookupFromValue,
  ownerFromUser,
  pickDefault,
  pickItemUnit,
  priceFromRecord,
  priceIsEditable,
  priceMethodsFromRecord,
  priceTypeLabel,
  appliedDiscountFromRecord,
  quoteTitleFromParty,
  removeQuoteItem,
  saveQuoteItem,
  searchCompanies,
  searchContacts,
  searchItems,
  taxAmount,
  taxOptionLabel,
  type DiscountKind,
  type DiscountValueType,
  type LookupOption,
  type QuoteLinePayload,
} from "@/lib/api/quote-lookups";
import { useAuth } from "@/lib/auth/AuthProvider";
import { QuoteCombobox } from "@/components/quote/QuoteCombobox";
import { QuoteTotalsPanel } from "@/components/quote/QuoteTotalsPanel";
import { QuoteMailDialog } from "@/components/quote/QuoteMailDialog";
import { QuoteTemplateDialog } from "@/components/quote/QuoteTemplateDialog";
import { EntityToolsPanel } from "@/components/tools/EntityToolsPanel";
import { Icon, IconLabel } from "@/components/ui/Icon";

interface Line {
  key: string;
  persistedId: string;
  item: LookupOption | null;
  name: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  multiples: number;
  qtyHint: string;
  unitPrice: number;
  priceType: string;
  scheme: LookupOption | null;
  schemes: LookupOption[];
  priceMethods: LookupOption[];
  unit: LookupOption | null;
  units: LookupOption[];
  discountInput: number;
  discountKind: DiscountKind;
  discountValueType: DiscountValueType;
  maxInlineDiscount: number;
  discountHint: string;
  voucher: LookupOption | null;
  taxes: LookupOption[];
}

function newLine(): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    persistedId: "",
    item: null,
    name: "",
    quantity: 1,
    minQuantity: 0,
    maxQuantity: 0,
    multiples: 1,
    qtyHint: "",
    unitPrice: 0,
    priceType: "MANUAL",
    scheme: null,
    schemes: [],
    priceMethods: [],
    unit: null,
    units: [],
    discountInput: 0,
    discountKind: "INLINEDISCOUNT",
    discountValueType: "PERCENTAGE",
    maxInlineDiscount: 100,
    discountHint: "",
    voucher: null,
    taxes: [],
  };
}

function voucherDiscountMode(voucher: LookupOption | null): DiscountValueType {
  const type = String(voucher?.extra?.DiscountValueType ?? "").toUpperCase();
  if (type.includes("PERCENT") || type === "%") return "PERCENTAGE";
  return "VALUE";
}

function voucherDiscountValue(voucher: LookupOption | null, fallback: number): number {
  const extra = voucher?.extra ?? {};
  const value = Number(extra.Value ?? extra.DiscountValue ?? extra.DiscountAmount ?? extra.Discount ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function lineDiscount(line: Line): number {
  if (isCatalogDiscount(line.discountKind)) {
    return discountAmount(
      line.unitPrice,
      line.quantity,
      voucherDiscountValue(line.voucher, line.discountInput),
      voucherDiscountMode(line.voucher),
    );
  }
  return discountAmount(line.unitPrice, line.quantity, line.discountInput, line.discountValueType);
}

function withClampedDiscount(line: Line): Line {
  if (isCatalogDiscount(line.discountKind)) {
    const applied = voucherDiscountValue(line.voucher, line.discountInput);
    return {
      ...line,
      discountHint: line.unitPrice <= 0 && applied > 0 ? "You cannot apply a discount when the unit price is 0." : "",
    };
  }
  const clamped = clampDiscount(
    line.discountInput,
    line.discountValueType,
    line.unitPrice,
    line.quantity,
    line.maxInlineDiscount,
  );
  return { ...line, discountInput: clamped.value, discountHint: clamped.hint };
}

function lineTax(line: Line): number {
  return line.taxes.reduce((sum, tax) => sum + taxAmount(line.unitPrice, line.quantity, tax), 0);
}

function lineTotal(line: Line): number {
  return lineNet(line.quantity, line.unitPrice, lineDiscount(line), lineTax(line));
}

function applyDefaultsToLine(line: Line, defaults: ReturnType<typeof itemDefaultsFromRecord>, option: LookupOption): Line {
  const qty = clampQuantity(
    defaults.quantity || line.quantity,
    defaults.minQuantity || line.minQuantity,
    defaults.maxQuantity || line.maxQuantity,
    defaults.multiples || line.multiples,
  );
  const schemes = defaults.schemes.length > 0 ? defaults.schemes : line.schemes;
  const scheme =
    schemes.find((row) => row.id === line.scheme?.id) ??
    schemes[0] ??
    line.scheme;
  const schemePrice = scheme?.extra ? priceFromRecord(scheme.extra) : 0;
  const unitPrice = defaults.unitPrice > 0 ? defaults.unitPrice : schemePrice > 0 ? schemePrice : line.unitPrice;
  const next = {
    ...line,
    item: { ...option, extra: mergeItemExtra(option.extra, defaults.extra) },
    name: defaults.itemName || option.label || line.name,
    quantity: qty.value,
    qtyHint: qty.hint || line.qtyHint,
    minQuantity: defaults.minQuantity || line.minQuantity,
    maxQuantity: defaults.maxQuantity || line.maxQuantity,
    multiples: defaults.multiples || line.multiples || 1,
    unitPrice,
    priceType: defaults.priceType || line.priceType || "MANUAL",
    schemes,
    scheme,
    priceMethods: defaults.priceMethods.length > 0 ? defaults.priceMethods : line.priceMethods,
    units: defaults.units.length > 0 ? defaults.units : line.units,
    unit: pickItemUnit(
      defaults.units.length > 0 ? defaults.units : line.units,
      defaults.extra,
      defaults.unit,
    ),
    discountInput: defaults.discountAmount > 0 ? defaults.discountAmount : line.discountInput,
    discountKind: line.discountKind || "INLINEDISCOUNT",
    discountValueType: line.discountValueType || "PERCENTAGE",
    maxInlineDiscount: defaults.maxInlineDiscount || line.maxInlineDiscount || 100,
    taxes: defaults.taxes.length > 0 ? defaults.taxes : defaults.tax ? [defaults.tax] : line.taxes,
  };
  return withClampedDiscount(next);
}

function payloadFromLine(line: Line, index: number): QuoteLinePayload {
  return {
    SequenceNo: index + 1,
    ...(line.persistedId ? { Id: line.persistedId } : {}),
    ItemId: line.item?.id,
    ItemName: line.name,
    PricePerUnit: line.unitPrice,
    PriceSchemeId: line.scheme?.id ?? "",
    Quantity: line.quantity,
    UnitId: line.unit?.id ?? "",
    OverrideQuantity: "",
    Discount: line.discountInput,
    DiscountValueType: isCatalogDiscount(line.discountKind) ? voucherDiscountMode(line.voucher) : line.discountValueType,
    DiscountType: line.discountKind,
    DiscountId: isCatalogDiscount(line.discountKind) ? line.voucher?.id ?? "" : "",
    Tax: lineTax(line),
    TaxId: line.taxes[0]?.id ?? "",
    TaxIds: line.taxes.map((tax) => tax.id).filter(Boolean),
    PriceType: line.priceType,
    extra: line.item?.extra,
  };
}

function lineFromServerRow(row: Record<string, unknown>, previous?: Line): Line {
  const persistedId = String(row.Id ?? row.QuoteItemId ?? row.ItemEntityId ?? previous?.persistedId ?? "");
  const itemId = String(row.ItemId ?? previous?.item?.id ?? "");
  const itemName = String(row.ItemName ?? row.Item ?? row.Name ?? previous?.name ?? "");
  const unitPrice = priceFromRecord(row) || previous?.unitPrice || 0;
  const quantity = Number(row.Quantity ?? previous?.quantity ?? 1);
  const priceType = String(row.PriceType ?? row.PricingType ?? previous?.priceType ?? "MANUAL");
  const schemeId = String(row.PriceSchemeId ?? row.PricingSchemeId ?? previous?.scheme?.id ?? "");
  const unitId = String(row.UnitId ?? previous?.unit?.id ?? "");
  const defaults = itemDefaultsFromRecord(row, itemId);
  const schemes = previous?.schemes?.length ? previous.schemes : defaults.schemes;
  const units = previous?.units?.length ? previous.units : defaults.units;
  const priceMethods = previous?.priceMethods?.length ? previous.priceMethods : priceMethodsFromRecord(row);
  const taxes = taxesFromItemRow(row);
  const applied = appliedDiscountFromRecord(row);
  return {
    key: previous?.key ?? `${persistedId || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    persistedId,
    item: itemId ? { id: itemId, label: itemName, extra: row } : (previous?.item ?? null),
    name: itemName,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    minQuantity: previous?.minQuantity || defaults.minQuantity || Number(row.MinQuantity ?? 0),
    maxQuantity: previous?.maxQuantity || defaults.maxQuantity || Number(row.MaxQuantity ?? 0),
    multiples: previous?.multiples || defaults.multiples || Number(row.Multiples ?? 1) || 1,
    qtyHint: previous?.qtyHint ?? "",
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    priceType,
    scheme: schemes.find((option) => option.id === schemeId) ?? previous?.scheme ?? (schemeId ? { id: schemeId, label: String(row.PriceScheme ?? schemeId) } : null),
    schemes,
    priceMethods,
    unit: pickItemUnit(units, row, previous?.unit ?? (unitId ? { id: unitId, label: String(row.ItemUnit ?? row.UnitName ?? row.Unit ?? unitId) } : null)),
    units,
    discountInput: applied?.input ?? previous?.discountInput ?? 0,
    discountKind: applied?.kind ?? previous?.discountKind ?? "INLINEDISCOUNT",
    discountValueType: applied?.valueType ?? previous?.discountValueType ?? "PERCENTAGE",
    maxInlineDiscount: previous?.maxInlineDiscount || defaults.maxInlineDiscount || 100,
    discountHint: previous?.discountHint ?? "",
    voucher: applied?.voucher ?? previous?.voucher ?? null,
    taxes: taxes.length > 0 ? taxes : previous?.taxes ?? defaults.taxes ?? (defaults.tax ? [defaults.tax] : []),
  };
}

function mergeServerLines(rows: Record<string, unknown>[], previous: Line[]): Line[] {
  const filled = rows.filter((row) => String(row.ItemName ?? row.Item ?? "").trim());
  const used = new Set<string>();
  const next = filled.map((row, index) => {
    const id = String(row.Id ?? row.QuoteItemId ?? row.ItemEntityId ?? "");
    const itemId = String(row.ItemId ?? "");
    const match =
      previous.find((line) => id && line.persistedId === id && !used.has(line.key)) ??
      previous.find((line) => itemId && line.item?.id === itemId && !line.persistedId && !used.has(line.key)) ??
      previous.find((line) => itemId && line.item?.id === itemId && !used.has(line.key)) ??
      previous.filter((line) => line.item?.id)[index];
    if (match) used.add(match.key);
    return lineFromServerRow(row, match);
  });
  const blank = previous.find((line) => !line.item?.id && !filled.some((row) => String(row.Id) === line.persistedId));
  if (blank && !used.has(blank.key)) next.push(blank);
  if (next.length === 0 || next.every((line) => line.item?.id)) next.push(newLine());
  return next;
}

async function enrichLinesWithDefaults(source: Line[], quoteId: string): Promise<Line[]> {
  return Promise.all(
    source.map(async (line) => {
      if (!line.item?.id) return line;
      try {
        const defaults = await getItemDefaults(line.item.id, line.item.extra ?? null, quoteId);
        if (!defaults) return line;
        const taxes =
          line.taxes.length > 0
            ? line.taxes
            : defaults.taxes.length > 0
              ? defaults.taxes
              : defaults.tax
                ? [defaults.tax]
                : [];
        return {
          ...line,
          unitPrice: line.unitPrice > 0 ? line.unitPrice : defaults.unitPrice,
          minQuantity: line.minQuantity || defaults.minQuantity,
          maxQuantity: line.maxQuantity || defaults.maxQuantity,
          multiples: line.multiples || defaults.multiples || 1,
          priceType: line.priceType || defaults.priceType || "MANUAL",
          schemes: line.schemes.length > 0 ? line.schemes : defaults.schemes,
          scheme: line.scheme ?? defaults.schemes[0] ?? null,
          priceMethods: line.priceMethods.length > 0 ? line.priceMethods : defaults.priceMethods,
          units: line.units.length > 0 ? line.units : defaults.units,
          unit: pickItemUnit(
            line.units.length > 0 ? line.units : defaults.units,
            null,
            line.unit ?? defaults.unit ?? null,
          ),
          taxes,
          discountInput: line.discountInput > 0 ? line.discountInput : defaults.discountAmount,
          maxInlineDiscount: line.maxInlineDiscount || defaults.maxInlineDiscount || 100,
          item: {
            ...line.item,
            extra: mergeItemExtra(line.item.extra, defaults.extra),
          },
        };
      } catch {
        return line;
      }
    }),
  );
}

function mergeOptions(current: LookupOption[], incoming: LookupOption[]): LookupOption[] {
  const merged = [...current];
  for (const row of incoming) {
    if (!merged.some((item) => item.id === row.id)) merged.push(row);
  }
  return merged;
}

function SelectedItemLabel({ line, loading }: { line: Line; loading?: boolean }) {
  const title = line.name || line.item?.label || "Item";
  const details = itemCaptionDetails(line.item?.extra, title);
  return (
    <div className="min-w-0 py-1">
      <p className="truncate text-sm font-medium text-slate-800" title={title}>
        {title}
      </p>
      {details.length ? (
        <p className="truncate text-[11px] text-slate-400" title={details.join(" · ")}>
          {details.join(" · ")}
        </p>
      ) : loading ? (
        <p className="text-[11px] text-slate-400">Loading details…</p>
      ) : null}
    </div>
  );
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function quoteIdFromPath(pathname: string): string {
  const match = pathname.match(/\/quote\/view\/([^/?#]+)/i);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function dateInputValue(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const iso = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

function mergeQuoteHeaders(primary?: TebQuoteHeader | null, secondary?: TebQuoteHeader | null): TebQuoteHeader {
  const a = primary ?? {};
  const b = secondary ?? {};
  const merged: TebQuoteHeader = { ...b, ...a };
  for (const [key, value] of Object.entries(b)) {
    if (merged[key] == null || merged[key] === "") merged[key] = value;
  }
  return merged;
}

function permissionTitle(allowed: boolean, action: string): string | undefined {
  return allowed ? undefined : `You don't have permission to ${action}`;
}

export function AddQuotePage({ quoteId: quoteIdProp }: { quoteId?: string } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const routeQuoteId = (quoteIdProp || quoteIdFromPath(pathname)).trim();
  const { user } = useAuth();
  const titleRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef(Date.now());
  const readyAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loadingExisting, setLoadingExisting] = useState(Boolean(routeQuoteId));

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState<LookupOption | null>(null);
  const [contact, setContact] = useState<LookupOption | null>(null);
  const [quoteType, setQuoteType] = useState<LookupOption | null>(null);
  const [location, setLocation] = useState<LookupOption | null>(null);
  const [workflow, setWorkflow] = useState<LookupOption | null>(null);
  const [currency, setCurrency] = useState<LookupOption | null>(null);
  const [owner, setOwner] = useState<LookupOption | null>(null);
  const [submittedDate, setSubmittedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validFor, setValidFor] = useState("30");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [headerEditing, setHeaderEditing] = useState(!routeQuoteId);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [quoteFor, setQuoteFor] = useState("");
  const [editContact, setEditContact] = useState(false);
  const titleAutoRef = useRef("");

  const [types, setTypes] = useState<LookupOption[]>([]);
  const [locations, setLocations] = useState<LookupOption[]>([]);
  const [workflows, setWorkflows] = useState<LookupOption[]>([]);
  const [currencies, setCurrencies] = useState<LookupOption[]>([]);
  const [owners, setOwners] = useState<LookupOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<LookupOption[]>([]);
  const [contactOptions, setContactOptions] = useState<LookupOption[]>([]);
  const [itemOptions, setItemOptions] = useState<LookupOption[]>([]);
  const [searching, setSearching] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [taxOptions, setTaxOptions] = useState<LookupOption[]>([]);
  const [discountTypes, setDiscountTypes] = useState<LookupOption[]>([
    { id: "INLINEDISCOUNT", label: "Inline" },
    { id: "VOUCHERDISCOUNT", label: "Voucher" },
  ]);
  const [discountCatalog, setDiscountCatalog] = useState<Record<string, LookupOption[]>>({});
  const [ingestingKey, setIngestingKey] = useState<string | null>(null);
  const [savingItems, setSavingItems] = useState(false);
  const savedIdRef = useRef(routeQuoteId);
  const linesRef = useRef<Line[]>([]);
  const persistTimers = useRef<Record<string, number>>({});
  const persistChain = useRef(Promise.resolve());

  const [saving, setSaving] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState(routeQuoteId);
  const [quoteStatus, setQuoteStatus] = useState("");
  const [quoteStatusId, setQuoteStatusId] = useState("");
  const [statusOptions, setStatusOptions] = useState<LookupOption[]>([]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priceMenuKey, setPriceMenuKey] = useState<string | null>(null);
  const [discountMenuKey, setDiscountMenuKey] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const priceMenuRef = useRef<HTMLDivElement>(null);
  const discountMenuRef = useRef<HTMLDivElement>(null);
  const [quoteCode, setQuoteCode] = useState("");
  const [defaultsReady, setDefaultsReady] = useState(false);
  const [viewActions, setViewActions] = useState<QuoteViewPermissions>(() =>
    routeQuoteId ? emptyQuoteViewPermissions() : defaultQuoteViewPermissions(),
  );
  const viewActionsRef = useRef(viewActions);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<"delete" | "revise" | "archive" | "copy" | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewActionsRef.current = viewActions;
  }, [viewActions]);

  useEffect(() => {
    if (!routeQuoteId) titleRef.current?.focus();
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => window.clearInterval(id);
  }, [routeQuoteId]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      const target = event.target as Node;
      if (!settingsRef.current?.contains(target)) setSettingsOpen(false);
      if (!statusMenuRef.current?.contains(target)) setStatusMenuOpen(false);
      if (!moreMenuRef.current?.contains(target)) setMoreMenuOpen(false);
      if (!priceMenuRef.current?.contains(target)) setPriceMenuKey(null);
      if (!discountMenuRef.current?.contains(target)) setDiscountMenuKey(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (routeQuoteId) return;
    const option = ownerFromUser(user);
    if (!option) return;
    setOwner(option);
    setOwners((current) => (current.some((row) => row.id === option.id) ? current : [option, ...current]));
  }, [user, routeQuoteId]);

  useEffect(() => {
    if (routeQuoteId) return;
    const fromSession = currencyFromSession();
    if (!fromSession) return;
    setCurrency(fromSession);
    setCurrencies((current) =>
      current.some((row) => row.id === fromSession.id) ? current : [fromSession, ...current],
    );
  }, [routeQuoteId]);

  useEffect(() => {
    let cancelled = false;
    const currentUserOption = ownerFromUser(user);
    setDefaultsReady(true);

    const keepAlive = <T,>(work: Promise<T>) => {
      void work.catch(() => undefined);
    };

    const lookupFallback = routeQuoteId ? "none" : "first";

    keepAlive(
      listQuoteTypes().then((rows) => {
        if (cancelled || rows.length === 0) return;
        setTypes(rows);
        setQuoteType((current) => pickDefault(rows, current?.id, lookupFallback) ?? current ?? (routeQuoteId ? null : rows[0]) ?? null);
      }),
    );

    keepAlive(
      listCurrencies().then((rows) => {
        if (cancelled || rows.length === 0) return;
        setCurrencies((current) => mergeOptions(current, rows));
        setCurrency((current) => pickDefault(rows, current?.id, lookupFallback) ?? current ?? (routeQuoteId ? null : rows[0]) ?? null);
      }),
    );

    keepAlive(
      getSubscriberUserCurrency().then((option) => {
        if (cancelled || !option) return;
        setCurrencies((current) => mergeOptions(current, [option]));
        setCurrency((current) => current ?? option);
      }),
    );

    keepAlive(
      listLocations().then((rows) => {
        if (cancelled || rows.length === 0) return;
        setLocations(rows);
        setLocation((current) => pickDefault(rows, current?.id, lookupFallback) ?? current ?? (routeQuoteId ? null : rows[0]) ?? null);
      }),
    );

    keepAlive(
      listOwners().then((rows) => {
        if (cancelled) return;
        const ownerList =
          currentUserOption && !rows.some((row) => row.id === currentUserOption.id)
            ? [currentUserOption, ...rows]
            : rows;
        setOwners(ownerList);
        if (currentUserOption && !routeQuoteId) setOwner(currentUserOption);
      }),
    );

    keepAlive(
      loadQuoteModuleFlags().then((flags) => {
        if (cancelled) return;
        setQuoteFor(flags.quoteFor ?? "");
        setEditContact(flags.editContact);
      }),
    );

    if (!routeQuoteId) {
      keepAlive(
        getQuoteDefaults()
          .then(async (raw) => {
            if (cancelled) return;
            const preferredType = lookupFromValue(raw.QuoteTypeId);
            const preferredLocation = lookupFromValue(raw.LocationId) ?? lookupFromValue(raw.SiteId);
            const preferredWorkflow = lookupFromValue(raw.WorkFlowId) ?? lookupFromValue(raw.WorkflowId);
            const preferredCurrency = lookupFromValue(raw.CurrencyId);
            if (preferredType) setQuoteType((current) => current ?? preferredType);
            if (preferredLocation) setLocation((current) => current ?? preferredLocation);
            if (preferredWorkflow) setWorkflow((current) => current ?? preferredWorkflow);
            if (preferredCurrency) {
              setCurrencies((current) => mergeOptions(current, [preferredCurrency]));
              setCurrency((current) => current ?? preferredCurrency);
            }
            const company = lookupFromValue(raw.CompanyId);
            const contact = lookupFromValue(raw.ContactId);
            if (company) {
              setCompany(company);
              setCompanyOptions([company]);
              const generated = quoteTitleFromParty(company, contact, quoteFor);
              if (generated) {
                setTitle((current) => {
                  if (!current.trim() || current.trim() === titleAutoRef.current) {
                    titleAutoRef.current = generated;
                    return generated;
                  }
                  return current;
                });
              }
              const rows = await searchContacts("", { isAll: true, parentId: company.id }).catch(() => []);
              if (cancelled) return;
              if (rows.length > 0) {
                setContactOptions(rows);
                setContact(pickDefault(rows, contact?.id) ?? contact ?? rows[0]);
              } else if (contact) {
                setContact(contact);
                setContactOptions([contact]);
              }
            } else if (contact) {
              setContact(contact);
              setContactOptions([contact]);
            }
          })
          .catch(() => undefined),
      );
    }

    return () => {
      cancelled = true;
    };
  }, [user?.UserId, routeQuoteId]);

  useEffect(() => {
    if (!defaultsReady) return;
    let cancelled = false;
    listWorkflows(location?.id ?? "")
      .then((rows) => {
        if (cancelled) return;
        if (!rows.length) return;
        setWorkflows(rows);
        setWorkflow((current) => {
          if (current && rows.some((row) => row.id === current.id)) return current;
          return pickDefault(rows, current?.id, routeQuoteId ? "none" : "first") ?? current;
        });
      })
      .catch(() => {
        // Keep any workflow already chosen from settings defaults.
      });
    return () => {
      cancelled = true;
    };
  }, [defaultsReady, location?.id, routeQuoteId]);

  const filledLines = useMemo(
    () => lines.filter((line) => Boolean(line.item?.id) && line.quantity > 0),
    [lines],
  );
  const subtotal = filledLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const discountTotal = filledLines.reduce((sum, line) => sum + lineDiscount(line), 0);
  const taxTotal = filledLines.reduce((sum, line) => sum + lineTax(line), 0);
  const total = filledLines.reduce((sum, line) => sum + lineTotal(line), 0);
  const taxLines = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; amount: number }>();
    for (const line of filledLines) {
      for (const tax of line.taxes) {
        const amount = taxAmount(line.unitPrice, line.quantity, tax);
        if (!tax.id || amount === 0) continue;
        const current = grouped.get(tax.id);
        if (current) {
          current.amount += amount;
          continue;
        }
        grouped.set(tax.id, { id: tax.id, label: taxOptionLabel(tax), amount });
      }
    }
    return [...grouped.values()];
  }, [filledLines]);
  const moneySymbol = currencySymbolFrom(currency ? { ...(currency.extra ?? {}), Id: currency.id, Label: currency.label } : null);

  const checks = {
    customer: Boolean(company || contact),
    title: title.trim().length > 0,
    type: Boolean(quoteType),
    location: Boolean(location),
    workflow: Boolean(workflow),
    currency: Boolean(currency),
    items: filledLines.length > 0,
  };
  const canSave = checks.title && checks.type && checks.location && checks.workflow && checks.currency;
  const headerSaved = Boolean(savedId);
  const canAddItem = viewActions.addItem;
  const canRemoveItem = viewActions.removeItem;
  const canUpdateItem = viewActions.updateItem;
  const canProcess = headerSaved && canSave && checks.items;
  const ready = canProcess;
  const showHeaderForm = !headerSaved || headerEditing;

  useEffect(() => {
    if (!showHeaderForm) setSettingsOpen(false);
  }, [showHeaderForm]);

  useEffect(() => {
    if (ready && readyAt.current == null) readyAt.current = Date.now() - startedAt.current;
  }, [ready]);

  const searchTimers = useRef<Record<string, number>>({});

  const runSearch = useCallback((kind: "company" | "contact" | "item", query: string, lineKey?: string) => {
    const trimmed = query.trim();
    const timerKey = `${kind}:${lineKey ?? ""}`;
    window.clearTimeout(searchTimers.current[timerKey]);
    if (kind === "item" && lineKey) setActiveItemKey(lineKey);
    searchTimers.current[timerKey] = window.setTimeout(() => {
      setSearching(kind);
      setSearchError((current) => ({ ...current, [kind]: "" }));
      const request =
        kind === "company"
          ? searchCompanies(trimmed, { isAll: true })
          : kind === "contact"
            ? searchContacts(trimmed, { isAll: true, parentId: company?.id })
            : searchItems(trimmed);
      void request
        .then((rows) => {
          if (kind === "company") setCompanyOptions(rows);
          if (kind === "contact") setContactOptions(rows);
          if (kind === "item") {
            setItemOptions(rows);
            if (lineKey) setActiveItemKey(lineKey);
          }
        })
        .catch((err) => {
          if (kind === "company") setCompanyOptions([]);
          if (kind === "contact") setContactOptions([]);
          if (kind === "item") setItemOptions([]);
          setSearchError((current) => ({
            ...current,
            [kind]: err instanceof TebApiError ? err.message : "Search failed",
          }));
        })
        .finally(() => setSearching(null));
    }, 200);
  }, [company?.id]);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((current) => {
      const next = current.map((line) => (line.key === key ? { ...line, ...patch } : line));
      linesRef.current = next;
      return next;
    });
  }

  function setLinesSynced(updater: (current: Line[]) => Line[]): Line[] {
    const next = updater(linesRef.current);
    linesRef.current = next;
    setLines(next);
    return next;
  }

  async function persistLineNow(key: string) {
    const quoteId = savedIdRef.current;
    if (!quoteId) return;
    const current = linesRef.current;
    const line = current.find((row) => row.key === key);
    if (!line?.item?.id || line.quantity <= 0) return;
    const allowed = line.persistedId ? viewActionsRef.current.updateItem : viewActionsRef.current.addItem;
    if (!allowed) return;
    const sequence = current.filter((row) => row.item?.id).findIndex((row) => row.key === key);
    const wasNew = !line.persistedId;
    setSavingItems(true);
    setError("");
    try {
      await saveQuoteItem(quoteId, payloadFromLine(line, sequence >= 0 ? sequence : 0));
      if (!wasNew) return;
      let view = await loadQuoteItems(quoteId);
      let next = mergeServerLines(view.ItemDetail, linesRef.current);
      const saved = next.find((row) => row.key === key) ?? next.find((row) => row.item?.id === line.item?.id && row.persistedId);
      if (saved?.persistedId && saved.taxes.length > 0) {
        const server = view.ItemDetail.find((row) => String(row.Id ?? "") === saved.persistedId);
        const have = new Set(taxesFromItemRow(server ?? {}).map((tax) => tax.id));
        for (const tax of saved.taxes) {
          if (!tax.id || have.has(tax.id)) continue;
          try {
            await applyQuoteItemTax(quoteId, saved.persistedId, tax.id);
            have.add(tax.id);
          } catch {
            // TaxId on ADDITEM is enough on some tenants.
          }
        }
        view = await loadQuoteItems(quoteId);
        next = mergeServerLines(view.ItemDetail, next);
      }
      next = await enrichLinesWithDefaults(next, quoteId);
      linesRef.current = next;
      setLines(next);
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not save the item.");
    } finally {
      setSavingItems(false);
    }
  }

  function persistLine(key: string, source?: Line[]) {
    if (source) linesRef.current = source;
    if (!savedIdRef.current) return Promise.resolve();
    const run = persistChain.current.then(() => persistLineNow(key));
    persistChain.current = run.catch(() => undefined);
    return run;
  }

  async function addLineTax(line: Line, tax: LookupOption) {
    if (!viewActionsRef.current.updateItem) return;
    if (!tax.id || line.taxes.some((row) => row.id === tax.id)) return;
    const next = setLinesSynced((current) =>
      current.map((row) => (row.key === line.key ? { ...row, taxes: [...row.taxes, tax] } : row)),
    );
    const saved = next.find((row) => row.key === line.key);
    const taxId = String(tax.extra?.TaxId ?? tax.extra?.Id ?? tax.id);
    if (savedIdRef.current && saved?.persistedId) {
      try {
        await applyQuoteItemTax(savedIdRef.current, saved.persistedId, taxId);
      } catch (err) {
        try {
          const sequence = next.filter((row) => row.item?.id).findIndex((row) => row.key === line.key);
          await saveQuoteItem(savedIdRef.current, payloadFromLine(saved, sequence >= 0 ? sequence : 0));
        } catch {
          setLinesSynced((current) =>
            current.map((row) =>
              row.key === line.key ? { ...row, taxes: row.taxes.filter((item) => item.id !== tax.id) } : row,
            ),
          );
          setError(err instanceof TebApiError ? err.message : "Could not apply the tax.");
        }
      }
      return;
    }
    void persistLine(line.key, next);
  }

  async function removeLineTax(line: Line, taxId: string) {
    if (!viewActionsRef.current.updateItem) return;
    const removed = line.taxes.find((tax) => tax.id === taxId) ?? null;
    const next = setLinesSynced((current) =>
      current.map((row) => (row.key === line.key ? { ...row, taxes: row.taxes.filter((tax) => tax.id !== taxId) } : row)),
    );
    const saved = next.find((row) => row.key === line.key);
    if (savedIdRef.current && line.persistedId) {
      try {
        await removeQuoteItemTax(savedIdRef.current, line.persistedId, taxId);
      } catch (err) {
        if (removed) {
          setLinesSynced((current) =>
            current.map((row) =>
              row.key === line.key && !row.taxes.some((tax) => tax.id === taxId)
                ? { ...row, taxes: [...row.taxes, removed] }
                : row,
            ),
          );
        }
        setError(err instanceof TebApiError ? err.message : "Could not remove the tax.");
      }
      return;
    }
    void persistLine(line.key, next);
  }

  function schedulePersistLine(key: string) {
    if (!savedIdRef.current) return;
    window.clearTimeout(persistTimers.current[key]);
    persistTimers.current[key] = window.setTimeout(() => {
      void persistLine(key);
    }, 500);
  }

  function flushPersistLine(key: string, source?: Line[]) {
    window.clearTimeout(persistTimers.current[key]);
    return persistLine(key, source);
  }

  function applyQuantity(key: string, raw: number) {
    if (!viewActionsRef.current.updateItem) return;
    const next = setLinesSynced((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const clamped = clampQuantity(raw, line.minQuantity, line.maxQuantity, line.multiples);
        return withClampedDiscount({ ...line, quantity: clamped.value, qtyHint: clamped.hint });
      }),
    );
    void flushPersistLine(key, next);
  }

  function applyDiscount(key: string, raw: number, patch: Partial<Line> = {}, persist: "debounce" | "flush" = "debounce") {
    if (!viewActionsRef.current.updateItem) return;
    const next = setLinesSynced((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        return withClampedDiscount({ ...line, ...patch, discountInput: raw, discountHint: "" });
      }),
    );
    if (persist === "flush") void flushPersistLine(key, next);
    else schedulePersistLine(key);
  }

  async function ingestCatalogItem(lineKey: string, option: LookupOption) {
    if (!viewActionsRef.current.addItem) return;
    setItemOptions([]);
    setIngestingKey(lineKey);
    setError("");
    const hinted = itemDefaultsFromRecord(option.extra ?? {}, option.id);
    hinted.itemName = hinted.itemName || option.label;
    setLinesSynced((current) =>
      current.map((line) => (line.key === lineKey ? applyDefaultsToLine(line, hinted, option) : line)),
    );
    try {
      const defaults = await getItemDefaults(option.id, option.extra ?? null, savedIdRef.current);
      if (defaults?.taxes?.length) setTaxOptions((current) => mergeOptions(current, defaults.taxes));
      else if (defaults?.tax) setTaxOptions((current) => mergeOption(current, defaults.tax));
      const next = setLinesSynced((current) => {
        const mapped = current.map((line) => {
          if (line.key !== lineKey) return line;
          return applyDefaultsToLine(line, defaults ?? hinted, option);
        });
        if (mapped.every((line) => line.item?.id) && viewActionsRef.current.addItem) mapped.push(newLine());
        return mapped;
      });
      await persistLine(lineKey, next);
    } catch (err) {
      setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not load item defaults.");
    } finally {
      setIngestingKey(null);
    }
  }

  async function deleteLine(line: Line) {
    if (!viewActionsRef.current.removeItem) return;
    if (line.persistedId && savedIdRef.current) {
      setSavingItems(true);
      try {
        await removeQuoteItem(savedIdRef.current, line.persistedId);
        const view = await loadQuoteItems(savedIdRef.current);
        setLines((current) => mergeServerLines(view.ItemDetail, current.filter((row) => row.key !== line.key)));
      } catch (err) {
        setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not remove the item.");
      } finally {
        setSavingItems(false);
      }
      return;
    }
    setLines((current) => (current.length === 1 ? [newLine()] : current.filter((row) => row.key !== line.key)));
  }

  function mergeOption(list: LookupOption[], option: LookupOption | null) {
    if (!option) return list;
    if (list.some((row) => row.id === option.id)) return list;
    return [option, ...list];
  }

  function priceTypeChoices(line: Line): LookupOption[] {
    const methods = [...line.priceMethods];
    for (const scheme of line.schemes) {
      if (methods.some((row) => row.id === scheme.id)) continue;
      methods.push({
        id: scheme.id,
        label: scheme.label,
        extra: { ...(scheme.extra ?? {}), PriceType: scheme.extra?.PriceType ?? line.priceType ?? "STANDARD", PriceSchemeId: scheme.id },
      });
    }
    if (!methods.some((row) => priceIsEditable(String(row.extra?.PriceType ?? row.id)))) {
      methods.push({ id: "MANUAL", label: "Manual", extra: { PriceType: "MANUAL", PricePerUnit: line.unitPrice } });
    }
    return methods;
  }

  function applyPriceChoice(line: Line, option: LookupOption) {
    if (!viewActionsRef.current.updateItem) return;
    const type = String(option.extra?.PriceType ?? option.id);
    const nextPrice = priceFromRecord(option.extra ?? {});
    const schemeId = String(option.extra?.PriceSchemeId ?? "");
    const next = setLinesSynced((current) =>
      current.map((row) => {
        if (row.key !== line.key) return row;
        return withClampedDiscount({
          ...row,
          priceType: type,
          unitPrice: nextPrice > 0 ? nextPrice : row.unitPrice,
          scheme: schemeId ? row.schemes.find((item) => item.id === schemeId) ?? row.scheme : row.scheme,
        });
      }),
    );
    setPriceMenuKey(null);
    void flushPersistLine(line.key, next);
  }

  async function loadDiscountCatalog(typeId: string, itemId?: string) {
    if (!savedIdRef.current || typeId === "INLINEDISCOUNT") return [];
    try {
      const rows = await listDiscountCatalog(savedIdRef.current, typeId, itemId);
      setDiscountCatalog((current) => ({ ...current, [typeId]: rows }));
      return rows;
    } catch {
      setDiscountCatalog((current) => ({ ...current, [typeId]: current[typeId] ?? [] }));
      return [];
    }
  }

  function applyDiscountKind(line: Line, kind: string, voucher: LookupOption | null = null) {
    if (!viewActionsRef.current.updateItem) return;
    const next = setLinesSynced((current) =>
      current.map((row) => {
        if (row.key !== line.key) return row;
        return withClampedDiscount({
          ...row,
          discountKind: kind,
          voucher: kind === "INLINEDISCOUNT" ? null : voucher,
        });
      }),
    );
    if (kind === "INLINEDISCOUNT" || voucher) {
      setDiscountMenuKey(null);
      void flushPersistLine(line.key, next);
    }
  }

  async function chooseDiscountType(line: Line, kind: string) {
    if (kind === "INLINEDISCOUNT") {
      applyDiscountKind(line, kind);
      return;
    }
    let rows = discountCatalog[kind];
    if (rows === undefined) rows = await loadDiscountCatalog(kind, line.item?.id);
    if (rows.length === 1) {
      applyDiscountKind(line, kind, rows[0]);
      return;
    }
    applyDiscountKind(line, kind, line.discountKind === kind ? line.voucher : null);
    if (rows.length === 0) setDiscountMenuKey(null);
  }

  function openDiscountMenu(line: Line) {
    if (!viewActionsRef.current.updateItem) return;
    setPriceMenuKey(null);
    setDiscountMenuKey((current) => (current === line.key ? null : line.key));
    for (const type of discountTypes) {
      if (type.id === "INLINEDISCOUNT" || discountCatalog[type.id] !== undefined) continue;
      void loadDiscountCatalog(type.id, line.item?.id);
    }
  }

  function maybeAutoTitle(nextCompany: LookupOption | null, nextContact: LookupOption | null) {
    const generated = quoteTitleFromParty(nextCompany, nextContact, quoteFor);
    if (!generated) return;
    setTitle((current) => {
      if (!current.trim() || current.trim() === titleAutoRef.current) {
        titleAutoRef.current = generated;
        return generated;
      }
      return current;
    });
  }

  function applyCompany(option: LookupOption) {
    if (headerSaved) return;
    setCompany(option);
    setCompanyOptions((current) => mergeOption(current, option));
    maybeAutoTitle(option, null);
    setContact(null);
    setSearching("contact");
    void searchContacts("", { isAll: true, parentId: option.id })
      .then((rows) => {
        setContactOptions(rows);
        const selected = rows[0] ?? null;
        if (selected) {
          setContact(selected);
          maybeAutoTitle(option, selected);
        }
      })
      .catch(() => setContactOptions([]))
      .finally(() => setSearching(null));
  }

  const persistRef = useRef<(mode: "draft" | "process") => Promise<void>>(async () => undefined);
  const persistHeaderRef = useRef<() => Promise<void>>(async () => undefined);
  const lastHeaderSignature = useRef("");

  function headerPayload(quoteId: string): Record<string, unknown> {
    const submitted = submittedDate ? `${submittedDate}T00:00:00.000Z` : "";
    return {
      Id: quoteId || "",
      Title: title.trim(),
      QuoteTitle: title.trim(),
      QuoteTypeId: quoteType?.id || "",
      LocationId: location?.id || "",
      CompanyId: company?.id || "",
      ContactId: contact?.id || "",
      WorkFlowId: workflow?.id || "",
      CurrencyId: currency?.id || "",
      OwnerId: owner?.id || "",
      SubmittedDate: submitted,
      SubmitDate: submitted,
      Validfor: validFor || "",
      Reference: reference || "",
      Description: description || "",
      AppType: company ? "TEBBusiness" : contact ? "TEBPeople" : "",
      TabIndex: 0,
      CustomField: [],
    };
  }

  async function persistHeader(closeEditing = false) {
    const quoteId = savedIdRef.current;
    if (!quoteId || !canSave || loadingExisting) return;
    const savedTitle = title.trim();
    if (!savedTitle) return;
    const payload = headerPayload(quoteId);
    const signature = JSON.stringify(payload);
    if (signature === lastHeaderSignature.current) {
      if (closeEditing) setHeaderEditing(false);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await saveQuoteHeader(payload, quoteId, QUOTE_ACTION.add);
      lastHeaderSignature.current = signature;
      if (closeEditing) setHeaderEditing(false);
    } catch (err) {
      setError(
        err instanceof TebApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not save the quote header.",
      );
    } finally {
      setSaving(false);
    }
  }
  persistHeaderRef.current = () => persistHeader(true);

  async function persist(_mode: "draft" | "process") {
    if (savedIdRef.current) {
      await persistHeader(true);
      return;
    }
    if (!canSave) {
      setError("Title, type, site, workflow, and currency are required to save.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const savedTitle = title.trim();
      if (!savedTitle) {
        setError("Title is required to save.");
        setSaving(false);
        return;
      }
      const quoteId = await saveQuoteHeader(headerPayload(""), "", QUOTE_ACTION.add);
      if (!quoteId) {
        throw new TebApiError("Quote was not saved", 500);
      }
      lastHeaderSignature.current = JSON.stringify(headerPayload(quoteId));
      setTitle(savedTitle);
      setSavedId(quoteId);
      savedIdRef.current = quoteId;
      setHeaderEditing(false);
      const detail = await getQuoteDetail(quoteId).catch(() => null);
      const persistedTitle = String(detail?.QuoteTitle ?? detail?.Title ?? "").trim();
      if (persistedTitle) setTitle(persistedTitle);
      if (detail) {
        setQuoteCode(detail.QuoteCode ? String(detail.QuoteCode) : "");
        setQuoteStatus(statusFromQuote(detail) || workflow?.label || "");
        setQuoteStatusId(String(detail.StatusId ?? detail.CurrentStatusId ?? ""));
        const fromDetail = statusesFromQuote(detail);
        if (fromDetail.length > 0) setStatusOptions((current) => mergeOptions(current, fromDetail));
      } else {
        setQuoteStatus((current) => current || workflow?.label || "");
      }
      if (quoteId && lines.length === 0) setLines([newLine()]);
      if (quoteId && quoteIdFromPath(pathname) !== quoteId) {
        router.replace(`/sales/quote/view/${quoteId}`);
      }
      void loadQuoteViewPermissions(quoteId, detail).then(setViewActions).catch(() => undefined);
    } catch (err) {
      setError(
        err instanceof TebApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not save the quote. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  persistRef.current = persist;

  useEffect(() => {
    savedIdRef.current = savedId;
  }, [savedId]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    return () => {
      Object.values(persistTimers.current).forEach((id) => window.clearTimeout(id));
    };
  }, []);

  useEffect(() => {
    if (!routeQuoteId) {
      setLoadingExisting(false);
      return;
    }
    let cancelled = false;
    setLoadingExisting(true);
    setError("");
    setSavedId(routeQuoteId);
    savedIdRef.current = routeQuoteId;
    setHeaderEditing(false);

    void (async () => {
      const [viewDetail, editDetail] = await Promise.all([
        getQuoteDetail(routeQuoteId).catch(() => null),
        getQuoteDetailForEdit(routeQuoteId).catch(() => null),
      ]);
      if (cancelled) return;
      const detail = mergeQuoteHeaders(viewDetail, editDetail);
      if (Object.keys(detail).length === 0) {
        setError("Could not load this quote.");
        setLoadingExisting(false);
        return;
      }

      const savedTitle = String(detail.QuoteTitle ?? detail.Title ?? "").trim();
      if (savedTitle) {
        setTitle(savedTitle);
        titleAutoRef.current = savedTitle;
      }
      setQuoteCode(detail.QuoteCode ? String(detail.QuoteCode) : "");
      setQuoteStatus(statusFromQuote(detail));
      setQuoteStatusId(String(detail.StatusId ?? detail.CurrentStatusId ?? ""));
      const fromDetail = statusesFromQuote(detail);
      if (fromDetail.length > 0) setStatusOptions((current) => mergeOptions(current, fromDetail));

      const companyOpt = lookupFromValue(detail.CompanyId, String(detail.CompanyName ?? ""));
      const contactOpt = lookupFromValue(detail.ContactId, String(detail.ContactName ?? ""));
      const typeOpt = lookupFromValue(detail.QuoteTypeId, String(detail.QuoteType ?? detail.QuoteTypeName ?? ""));
      const locationOpt = lookupFromValue(detail.LocationId, String(detail.LocationName ?? ""));
      const workflowOpt = lookupFromValue(
        detail.WorkFlowId ?? detail.WorkflowId,
        String(detail.WorkFlow ?? detail.Workflow ?? ""),
      );
      const currencyOpt = lookupFromValue(
        detail.CurrencyId,
        String(detail.CurrencySymbol ?? detail.CurrencyIcon ?? ""),
      );
      if (currencyOpt) {
        currencyOpt.extra = {
          ...(currencyOpt.extra ?? {}),
          CurrencyId: detail.CurrencyId,
          CurrencySymbol: detail.CurrencySymbol,
          CurrencyIcon: detail.CurrencyIcon ?? detail.CurrencySymbol,
          NativeSymbol: detail.CurrencySymbol ?? detail.CurrencyIcon,
        };
      }
      const ownerOpt = lookupFromValue(detail.OwnerId ?? detail.AssigneeId, String(detail.OwnerName ?? detail.AssigneeName ?? ""));

      if (companyOpt) {
        setCompany(companyOpt);
        setCompanyOptions((current) => mergeOptions(current, [companyOpt]));
      }
      if (contactOpt) {
        setContact(contactOpt);
        setContactOptions((current) => mergeOptions(current, [contactOpt]));
      }
      if (typeOpt) setQuoteType(typeOpt);
      if (locationOpt) setLocation(locationOpt);
      if (workflowOpt) setWorkflow(workflowOpt);
      if (currencyOpt) {
        setCurrency(currencyOpt);
        setCurrencies((current) => mergeOptions(current, [currencyOpt]));
      }
      if (ownerOpt) {
        setOwner(ownerOpt);
        setOwners((current) => mergeOptions(current, [ownerOpt]));
      }

      const submitted = dateInputValue(detail.SubmittedDate ?? detail.SubmitDate);
      if (submitted) setSubmittedDate(submitted);
      if (detail.Validfor != null && String(detail.Validfor).trim() !== "") setValidFor(String(detail.Validfor));
      if (detail.Reference != null) setReference(String(detail.Reference));
      if (detail.Description != null) setDescription(String(detail.Description));

      try {
        const view = await loadQuoteItems(routeQuoteId);
        if (cancelled) return;
        const merged = mergeServerLines(view.ItemDetail, []);
        const enriched = await enrichLinesWithDefaults(merged, routeQuoteId);
        if (!cancelled) setLines(enriched);
      } catch {
        if (!cancelled) setLines([newLine()]);
      }
      if (!cancelled) setLoadingExisting(false);
      if (!cancelled) {
        void loadQuoteViewPermissions(routeQuoteId, detail)
          .then((permissions) => {
            if (!cancelled) setViewActions(permissions);
          })
          .catch(() => {
            if (!cancelled) setViewActions(quoteViewPermissionsFrom(null, detail));
          });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeQuoteId]);

  useEffect(() => {
    let cancelled = false;
    listDiscountTypes()
      .then((rows) => {
        if (!cancelled && rows.length > 0) setDiscountTypes(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!savedId) return;
    let cancelled = false;
    listQuoteTaxes(savedId)
      .then((rows) => {
        if (!cancelled && rows.length > 0) setTaxOptions(rows);
      })
      .catch(() => undefined);
    const kinds = discountTypes.map((row) => row.id).filter((id) => id !== "INLINEDISCOUNT");
    void Promise.all(
      (kinds.length > 0 ? kinds : ["VOUCHERDISCOUNT"]).map(async (kind) => {
        try {
          const rows = await listDiscountCatalog(savedId, kind);
          if (!cancelled) setDiscountCatalog((current) => ({ ...current, [kind]: rows }));
        } catch {
          if (!cancelled) setDiscountCatalog((current) => ({ ...current, [kind]: current[kind] ?? [] }));
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [savedId, discountTypes]);

  useEffect(() => {
    if (taxOptions.length === 0) return;
    setLines((current) => {
      let changedLines = false;
      const next = current.map((line) => {
        if (line.taxes.length === 0) return line;
        let changed = false;
        const taxes = line.taxes.map((tax) => {
          const match =
            taxOptions.find((option) => option.id === tax.id) ??
            taxOptions.find((option) => option.label === tax.label);
          if (!match) return tax;
          const sameRate = match.extra?.TaxValue === tax.extra?.TaxValue && match.id === tax.id;
          if (sameRate) return tax;
          changed = true;
          return match;
        });
        if (!changed) return line;
        changedLines = true;
        return { ...line, taxes };
      });
      return changedLines ? next : current;
    });
  }, [taxOptions]);

  useEffect(() => {
    if (!savedId || !workflow?.id) return;
    let cancelled = false;
    listQuoteStatuses(workflow.id)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setStatusOptions((current) => mergeOptions(current, rows));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [savedId, workflow?.id]);

  useEffect(() => {
    if (quoteStatusId || !quoteStatus || statusOptions.length === 0) return;
    const match = statusOptions.find((row) => row.label.trim().toLowerCase() === quoteStatus.trim().toLowerCase());
    if (match) setQuoteStatusId(match.id);
  }, [quoteStatus, quoteStatusId, statusOptions]);

  async function selectStatus(option: LookupOption) {
    if (!savedId) {
      setStatusMenuOpen(false);
      return;
    }
    const sameStatus =
      Boolean(quoteStatusId) && option.id === quoteStatusId && option.label.trim().toLowerCase() === quoteStatus.trim().toLowerCase();
    if (sameStatus) {
      setStatusMenuOpen(false);
      return;
    }
    if (!workflow?.id) {
      setStatusMenuOpen(false);
      setError("Workflow is required to change quote status.");
      return;
    }
    setStatusMenuOpen(false);
    setError("");
    setChangingStatus(true);
    const previous = { label: quoteStatus, id: quoteStatusId };
    setQuoteStatus(option.label);
    setQuoteStatusId(option.id);
    try {
      await changeQuoteStatus({
        quoteId: savedId,
        workflowId: workflow.id,
        statusId: option.extra?.StatusId ? String(option.extra.StatusId) : option.id,
        assigneeId: owner?.id || (user?.UserId != null ? String(user.UserId) : undefined),
      });
      const detail = await getQuoteDetail(savedId).catch(() => null);
      if (detail) {
        setQuoteStatus(statusFromQuote(detail) || option.label);
        setQuoteStatusId(String(detail.StatusId ?? detail.CurrentStatusId ?? option.id));
        const fromDetail = statusesFromQuote(detail);
        if (fromDetail.length > 0) setStatusOptions((current) => mergeOptions(current, fromDetail));
      }
      void loadQuoteViewPermissions(savedId, detail)
        .then(setViewActions)
        .catch(() => setViewActions(quoteViewPermissionsFrom(null, detail)));
    } catch (err) {
      setQuoteStatus(previous.label);
      setQuoteStatusId(previous.id);
      setError(
        err instanceof TebApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not change quote status.",
      );
    } finally {
      setChangingStatus(false);
    }
  }

  const overflowItems = useMemo(() => {
    const items: Array<{
      id: "edit" | "copy" | "revise" | "archive" | "delete";
      label: string;
      icon: string;
      danger?: boolean;
    }> = [];
    if (viewActions.edit) items.push({ id: "edit", label: "Edit", icon: "edit" });
    if (viewActions.copy) items.push({ id: "copy", label: "Copy", icon: "content_copy" });
    if (viewActions.revise) items.push({ id: "revise", label: "Revise", icon: "history" });
    if (viewActions.archive) items.push({ id: "archive", label: "Archive", icon: "inventory_2" });
    if (viewActions.delete) items.push({ id: "delete", label: "Delete", icon: "delete", danger: true });
    return items;
  }, [viewActions]);

  async function runOverflowAction(id: (typeof overflowItems)[number]["id"]) {
    setMoreMenuOpen(false);
    if (!savedId) return;
    if (id === "edit") {
      setHeaderEditing(true);
      return;
    }
    if (id === "delete") {
      const titleLabel = title.trim() || "this quote";
      if (!window.confirm(`Delete ${titleLabel}? This cannot be undone.`)) return;
      setActionBusy("delete");
      setError("");
      try {
        await deleteQuote(savedId);
        router.push("/sales/quote/manage");
      } catch (err) {
        setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not delete the quote.");
      } finally {
        setActionBusy(null);
      }
      return;
    }
    if (id === "copy") {
      setActionBusy("copy");
      setError("");
      try {
        const nextId = await copyQuote(savedId);
        router.push(`/sales/quote/view/${nextId}`);
      } catch (err) {
        setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not copy the quote.");
      } finally {
        setActionBusy(null);
      }
      return;
    }
    if (id === "revise") {
      setActionBusy("revise");
      setError("");
      try {
        const nextId = await reviseQuote(savedId);
        if (nextId && nextId !== savedId) router.push(`/sales/quote/view/${nextId}`);
      } catch (err) {
        setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not revise the quote.");
      } finally {
        setActionBusy(null);
      }
      return;
    }
    if (id === "archive") {
      if (!window.confirm("Archive this quote?")) return;
      setActionBusy("archive");
      setError("");
      try {
        await archiveQuote(savedId);
        router.push("/sales/quote/manage");
      } catch (err) {
        setError(err instanceof TebApiError ? err.message : err instanceof Error ? err.message : "Could not archive the quote.");
      } finally {
        setActionBusy(null);
      }
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (savedIdRef.current) {
          window.clearTimeout(persistTimers.current.header);
          void persistHeaderRef.current();
        } else {
          void persistRef.current("draft");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [headerSaved]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {error ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white">
            <div className="flex min-h-[3.25rem]">
            <Link
              href="/sales/quote/manage"
              className="flex w-12 shrink-0 items-center justify-center border-r border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Back to quotes"
              title="Back to quotes"
            >
              <Icon name="chevron_left" size={22} />
            </Link>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="min-w-0 flex-1">
                {loadingExisting ? (
                  <>
                    <h1 className="truncate text-base font-semibold text-slate-900">Loading quote…</h1>
                    <p className="text-xs text-slate-500">Fetching header and items</p>
                  </>
                ) : headerSaved ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-base font-semibold text-slate-900">
                        {title.trim() || "Quote"}
                      </h1>
                      {quoteCode ? <span className="text-xs text-slate-400">{quoteCode}</span> : null}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {[company?.label, contact?.label, quoteType?.label, formatDate(submittedDate), reference]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </>
                ) : (
                  <>
                    <h1 className="text-sm font-semibold text-slate-900">Quote</h1>
                    <p className="text-xs text-slate-500">Draft {formatClock(elapsed)} · Save header to add items</p>
                  </>
                )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {headerSaved && headerEditing ? (
                  <button
                    type="button"
                    disabled={saving || loadingExisting || !canSave}
                    onClick={() => void persistHeader(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#086fb8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#065a96] disabled:opacity-50"
                  >
                    {saving ? "Saving…" : <IconLabel icon="save">Save</IconLabel>}
                  </button>
                ) : null}
                {headerSaved ? (
                  <div ref={statusMenuRef} className="relative">
                    <button
                      type="button"
                      disabled={changingStatus}
                      onClick={() => setStatusMenuOpen((open) => !open)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                      aria-haspopup="listbox"
                      aria-expanded={statusMenuOpen}
                      title="Change quote status"
                    >
                      {changingStatus ? "Updating…" : quoteStatus || "Status"}
                      <Icon name="expand_more" size={16} className="text-sky-600" />
                    </button>
                    {statusMenuOpen ? (
                      <div className="absolute right-0 z-40 mt-2 max-h-64 min-w-[14rem] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                        {statusOptions.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-slate-500">No statuses available</p>
                        ) : (
                          statusOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                                option.id === quoteStatusId ? "font-semibold text-[#086fb8]" : "text-slate-700"
                              }`}
                              onClick={() => void selectStatus(option)}
                            >
                              {option.label}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {showHeaderForm ? (
                <div ref={settingsRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setSettingsOpen((open) => !open)}
                    className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                    aria-label="Quote settings"
                    title="More details"
                  >
                    <Icon name="settings" size={20} />
                  </button>
                  {settingsOpen ? (
                    <div className="absolute right-0 z-40 mt-2 w-[22rem] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                      <p className="mb-3 text-sm font-semibold text-slate-900">More details</p>
                      <div className="grid grid-cols-1 gap-3">
                        <QuoteCombobox
                          label="Site"
                          required
                          value={location}
                          placeholder="Select site"
                          options={locations}
                          onQuery={() => undefined}
                          onSelect={setLocation}
                          onClear={() => undefined}
                        />
                        <QuoteCombobox
                          label="Workflow"
                          required
                          value={workflow}
                          placeholder="Workflow"
                          options={workflows}
                          onQuery={() => undefined}
                          onSelect={setWorkflow}
                          onClear={() => undefined}
                        />
                        <QuoteCombobox
                          label="Currency"
                          required
                          value={currency}
                          placeholder="Currency"
                          options={currencies}
                          onQuery={() => undefined}
                          onSelect={setCurrency}
                          onClear={() => undefined}
                        />
                        <QuoteCombobox
                          label="Owner"
                          value={owner}
                          placeholder="Owner"
                          options={owners}
                          onQuery={() => undefined}
                          onSelect={setOwner}
                          onClear={() => setOwner(null)}
                        />
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            Valid for (days)
                          </label>
                          <input
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#086fb8]"
                            value={validFor}
                            onChange={(event) => setValidFor(event.target.value)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            Description
                          </label>
                          <textarea
                            rows={2}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#086fb8]"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                ) : null}
              </div>
            </div>
            {headerSaved ? (
              <>
              <button
                type="button"
                className="flex w-12 shrink-0 self-stretch items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                aria-label="Send email"
                title={viewActions.sendMail ? "Send email" : "You don't have permission to send email"}
                disabled={!viewActions.sendMail || Boolean(actionBusy) || loadingExisting}
                onClick={() => setMailOpen(true)}
              >
                <Icon name="mail" size={22} />
              </button>
              <button
                type="button"
                className="flex w-12 shrink-0 self-stretch items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                aria-label="View template"
                title={viewActions.viewTemplate ? "View template" : "You don't have permission to view the template"}
                disabled={!viewActions.viewTemplate || Boolean(actionBusy) || loadingExisting}
                onClick={() => setTemplateOpen(true)}
              >
                <Icon name="description" size={22} />
              </button>
              <div ref={moreMenuRef} className="relative flex w-12 shrink-0 self-stretch">
                <button
                  type="button"
                  className="flex h-full w-full items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40"
                  aria-label="More quote actions"
                  aria-haspopup="menu"
                  aria-expanded={moreMenuOpen}
                  disabled={Boolean(actionBusy) || loadingExisting}
                  title="More actions"
                  onClick={() => setMoreMenuOpen((open) => !open)}
                >
                  <Icon name="more_vert" size={22} />
                </button>
                {moreMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 min-w-[12.5rem] border border-slate-200 bg-white py-1 shadow-xl"
                  >
                    {overflowItems.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-500">No actions for this stage</p>
                    ) : (
                      overflowItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          disabled={Boolean(actionBusy)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 ${
                            item.danger ? "text-red-600" : "text-slate-700"
                          }`}
                          onClick={() => void runOverflowAction(item.id)}
                        >
                          <IconLabel icon={item.icon}>
                            {actionBusy === item.id ? `${item.label}…` : item.label}
                          </IconLabel>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              </>
            ) : null}
            </div>
            {showHeaderForm ? (
              <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
                <div title={headerSaved ? "Company cannot be changed after the quote is saved" : undefined}>
                <QuoteCombobox
                  label="Company"
                  value={company}
                  placeholder="Search company"
                  options={companyOptions}
                  loading={searching === "company"}
                  error={searchError.company}
                  serverFilter
                  disabled={headerSaved}
                  onQuery={(query) => runSearch("company", query)}
                  onOpen={() => runSearch("company", "")}
                  onSelect={applyCompany}
                  onClear={() => {
                    if (headerSaved) return;
                    setCompany(null);
                    setCompanyOptions([]);
                    setContact(null);
                    setContactOptions([]);
                  }}
                />
                </div>
                <QuoteCombobox
                  label="Contact"
                  value={contact}
                  placeholder={company ? "Search contact at this company" : "Search contact"}
                  options={contactOptions}
                  loading={searching === "contact"}
                  error={searchError.contact}
                  serverFilter
                  disabled={headerSaved && !editContact}
                  onQuery={(query) => runSearch("contact", query)}
                  onOpen={() => runSearch("contact", "")}
                  onSelect={(option) => {
                    if (headerSaved && !editContact) return;
                    setContact(option);
                    maybeAutoTitle(company, option);
                  }}
                  onClear={() => {
                    if (headerSaved && !editContact) return;
                    setContact(null);
                    setContactOptions([]);
                  }}
                />
                <QuoteCombobox
                  label="Type"
                  required
                  value={quoteType}
                  placeholder="Select type"
                  options={types}
                  onQuery={() => undefined}
                  onSelect={setQuoteType}
                  onClear={() => undefined}
                />
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={titleRef}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#086fb8] focus:ring-2 focus:ring-[#086fb8]/20"
                    placeholder="Quote title"
                    value={title}
                    onChange={(event) => {
                      const next = event.target.value;
                      setTitle(next);
                      if (next.trim() !== titleAutoRef.current) {
                        titleAutoRef.current = "";
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Submit date
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#086fb8]"
                    value={submittedDate}
                    onChange={(event) => setSubmittedDate(event.target.value)}
                  />
                </div>
                <div className="md:col-span-1 xl:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Reference
                  </label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#086fb8]"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
      </section>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <section className="min-h-0 min-w-0 flex-1 overflow-auto bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Items</h2>
                {savingItems || ingestingKey ? (
                  <span className="text-xs text-slate-500">{ingestingKey ? "Loading item…" : "Saving items…"}</span>
                ) : null}
              </div>
              {headerSaved ? (
                <button
                  type="button"
                  disabled={!canAddItem}
                  title={permissionTitle(canAddItem, "add an item")}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#086fb8] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    if (!canAddItem) return;
                    setLines((current) => [...current, newLine()]);
                  }}
                >
                  <IconLabel icon="add">Add line</IconLabel>
                </button>
              ) : null}
            </div>
            {headerSaved ? (
            <div className="overflow-visible">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.06em] text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Item</th>
                    <th className="w-36 px-2 py-2 font-semibold">Qty</th>
                    <th className="w-40 px-2 py-2 font-semibold">Price</th>
                    <th className="w-40 px-2 py-2 font-semibold">Discount</th>
                    <th className="w-44 px-2 py-2 font-semibold">Tax</th>
                    <th className="w-32 px-2 py-2 text-right font-semibold">Amount</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const taxes = mergeOptions(taxOptions, line.taxes);
                    const catalog = mergeOption(discountCatalog[line.discountKind] ?? [], line.voucher);
                    const priceLocked = !priceIsEditable(line.priceType);
                    const itemLocked = !canUpdateItem;
                    const unitEditable = !itemLocked && !priceLocked && line.units.length > 1;
                    const unitLabel = line.unit?.label || "";
                    return (
                    <tr key={line.key} className="border-t border-slate-100 align-top">
                      <td className="relative z-20 px-4 py-2">
                        {line.item?.id ? (
                          <SelectedItemLabel line={line} loading={ingestingKey === line.key} />
                        ) : (
                          <QuoteCombobox
                            label=""
                            value={null}
                            placeholder={canAddItem ? "Type to find an item" : "No permission to add items"}
                            options={activeItemKey === line.key ? itemOptions : []}
                            loading={searching === "item" && activeItemKey === line.key}
                            error={activeItemKey === line.key ? searchError.item : undefined}
                            disabled={!canAddItem}
                            serverFilter
                            onOpen={() => runSearch("item", "", line.key)}
                            onQuery={(query) => runSearch("item", query, line.key)}
                            onSelect={(option) => {
                              void ingestCatalogItem(line.key, option);
                            }}
                            onClear={() => undefined}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1">
                          <input
                            type="number"
                            min={0}
                            disabled={itemLocked}
                            title={permissionTitle(canUpdateItem, "update this item")}
                            className="w-full rounded-md border border-slate-200 px-2 py-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                            value={line.quantity}
                            onChange={(event) => {
                              if (itemLocked) return;
                              updateLine(line.key, { quantity: Number(event.target.value) || 0, qtyHint: "" });
                              schedulePersistLine(line.key);
                            }}
                            onBlur={(event) => applyQuantity(line.key, Number(event.target.value) || 0)}
                          />
                          {unitEditable ? (
                            <select
                              className="w-full cursor-pointer appearance-none border-0 bg-transparent px-0 py-0 text-[11px] text-slate-400 outline-none"
                              value={line.unit?.id ?? line.units[0]?.id ?? ""}
                              title="Item unit"
                              aria-label="Item unit"
                              onChange={(event) => {
                                const unit = line.units.find((option) => option.id === event.target.value) ?? null;
                                if (!unit) return;
                                const next = setLinesSynced((current) => current.map((row) => (row.key === line.key ? { ...row, unit } : row)));
                                void flushPersistLine(line.key, next);
                              }}
                            >
                              {line.units.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : unitLabel ? (
                            <p
                              className="text-[11px] text-slate-400"
                              title={
                                priceLocked && line.units.length > 1
                                  ? "Switch pricing type to Manual to change unit"
                                  : "Item unit"
                              }
                            >
                              {unitLabel}
                            </p>
                          ) : null}
                          {line.qtyHint ? <p className="text-[11px] text-amber-700">{line.qtyHint}</p> : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-md border border-slate-200 focus-within:border-[#086fb8] focus-within:ring-2 focus-within:ring-[#086fb8]/20">
                              {moneySymbol ? (
                                <span className="shrink-0 pl-2 text-sm text-slate-500">{moneySymbol}</span>
                              ) : null}
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                readOnly={priceLocked || itemLocked}
                                title={
                                  itemLocked
                                    ? permissionTitle(false, "update this item")
                                    : priceLocked
                                      ? "Unit price is set by the item price type"
                                      : undefined
                                }
                                className={`min-w-0 flex-1 border-0 bg-transparent px-2 py-2 outline-none ${priceLocked || itemLocked ? "bg-slate-50 text-slate-600" : ""}`}
                                value={line.unitPrice}
                                onChange={(event) => {
                                  if (priceLocked || itemLocked) return;
                                  applyDiscount(line.key, line.discountInput, { unitPrice: Number(event.target.value) || 0 });
                                }}
                                onBlur={(event) => {
                                  if (priceLocked || itemLocked) return;
                                  applyDiscount(line.key, line.discountInput, { unitPrice: Number(event.target.value) || 0 }, "flush");
                                }}
                              />
                            </div>
                            {line.item?.id && (line.priceMethods.length > 0 || line.schemes.length > 0 || Boolean(line.priceType)) ? (
                              <div className="relative" ref={priceMenuKey === line.key ? priceMenuRef : undefined}>
                                <button
                                  type="button"
                                  disabled={itemLocked}
                                  className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-[#086fb8] disabled:cursor-not-allowed disabled:opacity-40"
                                  title={permissionTitle(canUpdateItem, "update this item") ?? `Pricing: ${priceTypeLabel(line.priceType)}`}
                                  aria-label="Change pricing type"
                                  onClick={() => {
                                    if (itemLocked) return;
                                    setDiscountMenuKey(null);
                                    setPriceMenuKey((current) => (current === line.key ? null : line.key));
                                  }}
                                >
                                  <Icon name="sell" size={16} />
                                </button>
                                {priceMenuKey === line.key ? (
                                  <div className="absolute right-0 z-40 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                      Pricing type
                                    </p>
                                    {priceTypeChoices(line).map((option) => {
                                      const type = String(option.extra?.PriceType ?? option.id);
                                      const active = type.toUpperCase() === line.priceType.toUpperCase() || option.id === line.scheme?.id;
                                      const optionPrice = priceFromRecord(option.extra ?? {});
                                      return (
                                        <button
                                          key={option.id}
                                          type="button"
                                          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                                            active ? "font-semibold text-[#086fb8]" : "text-slate-700"
                                          }`}
                                          onClick={() => applyPriceChoice(line, option)}
                                        >
                                          <span>{option.label || priceTypeLabel(type)}</span>
                                          {optionPrice > 0 ? (
                                            <span className="tabular-nums text-xs text-slate-400">{formatAmount(optionPrice, moneySymbol)}</span>
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          {line.item?.id && line.priceType ? (
                            <p className="text-[11px] text-slate-400">{priceTypeLabel(line.priceType)}</p>
                          ) : null}
                          {line.schemes.length > 0 ? (
                            <select
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-50"
                              value={line.scheme?.id ?? ""}
                              disabled={itemLocked}
                              title={permissionTitle(canUpdateItem, "update this item")}
                              onChange={(event) => {
                                if (itemLocked) return;
                                const scheme = line.schemes.find((option) => option.id === event.target.value) ?? null;
                                const schemePrice = scheme?.extra ? priceFromRecord(scheme.extra) : 0;
                                const next = setLinesSynced((current) =>
                                  current.map((row) =>
                                    row.key === line.key
                                      ? withClampedDiscount({
                                          ...row,
                                          scheme,
                                          unitPrice: schemePrice > 0 ? schemePrice : row.unitPrice,
                                        })
                                      : row,
                                  ),
                                );
                                void flushPersistLine(line.key, next);
                              }}
                            >
                              <option value="">Scheme</option>
                              {line.schemes.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <div className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-slate-200 focus-within:border-[#086fb8]">
                              {line.discountValueType === "VALUE" && moneySymbol ? (
                                <span className="shrink-0 self-center pl-2 text-sm text-slate-500">{moneySymbol}</span>
                              ) : null}
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                disabled={itemLocked || isCatalogDiscount(line.discountKind)}
                                aria-label="Discount"
                                title={permissionTitle(canUpdateItem, "update this item")}
                                className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 outline-none disabled:bg-slate-50"
                                value={isCatalogDiscount(line.discountKind) ? voucherDiscountValue(line.voucher, line.discountInput) : line.discountInput}
                                onChange={(event) => applyDiscount(line.key, Number(event.target.value) || 0)}
                                onBlur={(event) => applyDiscount(line.key, Number(event.target.value) || 0, {}, "flush")}
                              />
                              {line.discountKind === "INLINEDISCOUNT" ? (
                                <div className="flex shrink-0 border-l border-slate-200 bg-slate-50 text-[11px] font-semibold">
                                  <button
                                    type="button"
                                    disabled={itemLocked}
                                    className={`w-7 disabled:opacity-40 ${
                                      line.discountValueType === "PERCENTAGE"
                                        ? "bg-white text-[#086fb8]"
                                        : "text-slate-400 hover:text-slate-600"
                                    }`}
                                    aria-label="Discount as percent"
                                    aria-pressed={line.discountValueType === "PERCENTAGE"}
                                    onClick={() => applyDiscount(line.key, line.discountInput, { discountValueType: "PERCENTAGE" }, "flush")}
                                  >
                                    %
                                  </button>
                                  <button
                                    type="button"
                                    disabled={itemLocked}
                                    className={`w-8 border-l border-slate-200 disabled:opacity-40 ${
                                      line.discountValueType === "VALUE"
                                        ? "bg-white text-[#086fb8]"
                                        : "text-slate-400 hover:text-slate-600"
                                    }`}
                                    aria-label="Discount as amount"
                                    aria-pressed={line.discountValueType === "VALUE"}
                                    onClick={() => applyDiscount(line.key, line.discountInput, { discountValueType: "VALUE" }, "flush")}
                                  >
                                    {moneySymbol || "Amt"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <div className="relative" ref={discountMenuKey === line.key ? discountMenuRef : undefined}>
                              <button
                                type="button"
                                disabled={itemLocked}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-[#086fb8] disabled:cursor-not-allowed disabled:opacity-40"
                                title={permissionTitle(canUpdateItem, "update this item") ?? `Discount: ${discountTypeLabel(line.discountKind, discountTypes)}`}
                                aria-label="Change discount type"
                                onClick={() => openDiscountMenu(line)}
                              >
                                <Icon name="percent" size={16} />
                              </button>
                              {discountMenuKey === line.key ? (
                                <div className="absolute right-0 z-40 mt-1 min-w-[13rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                    Discount type
                                  </p>
                                  {discountTypes.map((type) => {
                                    if (type.id === "INLINEDISCOUNT") {
                                      return (
                                        <button
                                          key={type.id}
                                          type="button"
                                          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                                            line.discountKind === "INLINEDISCOUNT" ? "font-semibold text-[#086fb8]" : "text-slate-700"
                                          }`}
                                          onClick={() => chooseDiscountType(line, type.id)}
                                        >
                                          {type.label}
                                        </button>
                                      );
                                    }
                                    const items = mergeOption(discountCatalog[type.id] ?? [], line.discountKind === type.id ? line.voucher : null);
                                    if (items.length === 0) {
                                      return (
                                        <button
                                          key={type.id}
                                          type="button"
                                          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                                            line.discountKind === type.id ? "font-semibold text-[#086fb8]" : "text-slate-700"
                                          }`}
                                          onClick={() => void chooseDiscountType(line, type.id)}
                                        >
                                          <span>{type.label}</span>
                                          {discountCatalog[type.id] === undefined ? (
                                            <span className="text-[11px] font-normal text-slate-400">…</span>
                                          ) : null}
                                        </button>
                                      );
                                    }
                                    return (
                                      <div key={type.id}>
                                        <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                          {type.label}
                                        </p>
                                        {items.map((option) => {
                                          const active = line.discountKind === type.id && line.voucher?.id === option.id;
                                          return (
                                            <button
                                              key={`${type.id}-${option.id}`}
                                              type="button"
                                              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                                                active ? "font-semibold text-[#086fb8]" : "text-slate-700"
                                              }`}
                                              onClick={() => applyDiscountKind(line, type.id, option)}
                                            >
                                              <span>{option.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {isCatalogDiscount(line.discountKind)
                              ? line.voucher?.label || discountTypeLabel(line.discountKind, discountTypes)
                              : "Inline"}
                          </p>
                          {isCatalogDiscount(line.discountKind) && catalog.length > 0 && !line.voucher ? (
                            <select
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                              value=""
                              onChange={(event) => {
                                const voucher = catalog.find((option) => option.id === event.target.value) ?? null;
                                applyDiscountKind(line, line.discountKind, voucher);
                              }}
                            >
                              <option value="">Select discount</option>
                              {catalog.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {line.discountHint ? <p className="text-[11px] text-amber-700">{line.discountHint}</p> : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1">
                          {line.taxes.map((tax) => (
                            <span
                              key={tax.id}
                              className="inline-flex min-w-0 items-center justify-between gap-1 rounded-md bg-slate-100 px-1.5 py-1 text-[11px] text-slate-700"
                            >
                              <span className="min-w-0 truncate" title={taxOptionLabel(tax)}>
                                {taxOptionLabel(tax)}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 text-slate-400 hover:text-red-600"
                                aria-label={`Remove ${taxOptionLabel(tax)}`}
                                onClick={() => void removeLineTax(line, tax.id)}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </span>
                          ))}
                          <select
                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                            value=""
                            aria-label="Add tax"
                            onChange={(event) => {
                              const tax = taxes.find((option) => option.id === event.target.value);
                              if (tax) void addLineTax(line, tax);
                            }}
                          >
                            <option value="">{line.taxes.length > 0 ? "Add tax" : "No tax"}</option>
                            {taxes
                              .filter((option) => !line.taxes.some((tax) => tax.id === option.id))
                              .map((option) => (
                                <option key={option.id} value={option.id}>
                                  {taxOptionLabel(option)}
                                </option>
                              ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-2 py-7 text-right font-medium tabular-nums">{formatAmount(lineTotal(line), moneySymbol)}</td>
                      <td className="px-2 py-7">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-red-600"
                          aria-label="Remove line"
                          onClick={() => void deleteLine(line)}
                        >
                          <Icon name="close" size={18} />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <p className="text-sm text-slate-600">Save the quote header to add items.</p>
              <button
                type="button"
                disabled={saving || !canSave}
                onClick={() => void persist("draft")}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#086fb8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#065a96] disabled:opacity-50"
              >
                {saving ? "Saving…" : <IconLabel icon="save">Save quote</IconLabel>}
              </button>
            </div>
            )}
          </section>
      </div>

      <div className="flex shrink-0 border-t border-slate-200 bg-white">
        <div className="flex min-w-0 flex-1 flex-col">
          {headerSaved && savedId ? (
            <EntityToolsPanel
              entityId={savedId}
              module={QUOTE_MODULE.estimation}
              open={dockOpen}
              onOpenChange={setDockOpen}
            />
          ) : (
            <>
              {dockOpen ? (
                <p className="px-4 py-3 text-xs text-slate-500">
                  Save the header to add items · Site, workflow, and currency are in settings
                </p>
              ) : null}
              <div className="flex h-10 shrink-0 items-center justify-end px-3">
                <button
                  type="button"
                  onClick={() => setDockOpen((current) => !current)}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={dockOpen ? "Collapse dock" : "Expand dock"}
                  aria-expanded={dockOpen}
                >
                  <Icon name={dockOpen ? "expand_more" : "expand_less"} size={18} />
                </button>
              </div>
            </>
          )}
        </div>
        <QuoteTotalsPanel
          symbol={moneySymbol}
          subtotal={subtotal}
          discount={discountTotal}
          tax={taxTotal}
          taxLines={taxLines}
          total={total}
          expanded={dockOpen}
        />
      </div>
      {savedId ? (
        <>
          <QuoteMailDialog quoteId={savedId} locationId={location?.id} open={mailOpen} onClose={() => setMailOpen(false)} />
          <QuoteTemplateDialog
            quoteId={savedId}
            locationId={location?.id}
            open={templateOpen}
            onClose={() => setTemplateOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
