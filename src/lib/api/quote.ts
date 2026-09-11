import { tebRequest } from "@/lib/api/client";
import { listManageRecords } from "@/lib/api/manage-grid";
import { TebApiError, type TebApiEnvelope } from "@/lib/api/types";

/** Live module identifiers for Quote (Estimation). */
export const QUOTE_MODULE = {
  /** Dynamic AcGetData Module / form metadata */
  estimation: "EstimationManagement",
  /** Manage-list Module code sent to AcGetData */
  tebQuote: "TEBQuote",
  screenAdd: "QUOTE",
  screenManage: "MANAGE",
  screenItem: "ITEMQUOTE",
  screenView: "VIEWQUOTEINFO",
} as const;

export const QUOTE_ACTION = {
  getDetail: "GETQUOTEDETAIL",
  getDetailEdit: "QUOTEDETAILEDIT",
  getActivity: "GETQUOTEACTIVITY",
  add: "ADD",
  copy: "COPYQUOTE",
  update: "UPDATE",
  delete: "DELETE",
  revise: "REV",
  archive: "ARC",
  viewToolbar: "VIEWTOOLBAR",
  checkDeletePermission: "CHECKDELETEPERMISSION",
  getPricingScheme: "GETPRICINGSCHEME",
  getStoryboard: "GETSTORYBOARD",
  getCompanyContactList: "GETCOMPANYCONTACTLIST",
  getCustomerLocationList: "GETCUSTOMERLOCATIONLIST",
  getCustomerFinanceList: "GETCUSTOMERFINANCELIST",
  addItem: "ADDITEM",
  addMultipleItem: "ADDMULTIPLEITEM",
  quoteDefault: "QUOTEDEFAULT",
  changeStatus: "CHANGEQUOTESTATUS",
  validateFields: "QUOTEVALIDATEFIELDS",
  viewItem: "VIEWITEM",
  viewConsumedItem: "VIEWCONSUMEDITEM",
  removeItem: "REMOVEITEM",
  taxDropdown: "TAXDROPDOWN",
  addItemTax: "ADDITEMTAX",
  removeItemTax: "REMOVEITEMTAX",
} as const;

export interface TebAcGetDataRequest {
  Module: string;
  Code: string;
  PrimaryKey?: string | number;
  Data?: string;
  Action: string;
  FilterModule?: string;
  FilterId?: string | number | null;
  ComponentCode?: string;
}

export interface TebQuoteHeader {
  Id?: string;
  Title?: string;
  QuoteTitle?: string;
  QuoteCode?: string;
  QuoteTypeId?: string;
  CompanyId?: string;
  CompanyName?: string;
  ContactId?: string;
  ContactName?: string;
  LocationId?: string;
  LocationName?: string;
  WorkFlowId?: string;
  WorkFlow?: string;
  CurrencyId?: string;
  CurrencySymbol?: string;
  CurrencyIcon?: string;
  SubmittedDate?: string;
  Validfor?: number | string;
  Reference?: string;
  Description?: string;
  OwnerId?: string;
  OwnerName?: string;
  AssigneeId?: string;
  AssigneeName?: string;
  CreatedBy?: string;
  ModifiedBy?: string;
  CreatedDate?: string;
  ModifiedDate?: string;
  Status?: string;
  StatusName?: string;
  CurrentStatus?: string;
  StatusId?: string;
  ParentValue?: string;
  WorkFlowDetail?: string | unknown;
  AppType?: string;
  EntityId?: string;
  OpportunityId?: string;
  CustomField?: unknown[];
  Consent?: string[];
  [key: string]: unknown;
}

export interface TebQuoteListPage {
  Data: TebQuoteHeader[];
  TotalCount: number;
}

export interface TebQuoteListQuery {
  filterId?: string | number | null;
  filterValues?: unknown;
  fullTextSearch?: string;
  pageNumber?: number;
  pageSize?: number;
  sortColumn?: string;
  sortOrder?: boolean;
}

/**
 * Live Quote APIs. Hosts and envelopes match the quote remote at
 * `prodapps.teb.cloud/quote` — no backend changes.
 *
 * Dynamic calls wrap the payload as `{ data: ... }` (ParamName = "data").
 * Manage-list uses the same AcGetData URL but posts the paging object unwrapped
 * (live `microApiPost`).
 */
export async function acGetData<T = unknown>(payload: TebAcGetDataRequest): Promise<TebApiEnvelope<T>> {
  return tebRequest<T>("DYNAMIC", "AcGetData", {
    method: "POST",
    body: { data: payload },
  });
}

export async function acAddDetail<T = unknown>(payload: TebAcGetDataRequest): Promise<TebApiEnvelope<T>> {
  return tebRequest<T>("DYNAMIC", "AcAddDetail", {
    method: "POST",
    body: { data: payload },
  });
}

/** Manage Quote grid. */
export async function listQuotes(query: TebQuoteListQuery = {}): Promise<TebQuoteListPage> {
  const page = await listManageRecords<TebQuoteHeader>({
    module: QUOTE_MODULE.estimation,
    code: QUOTE_MODULE.screenManage,
    action: QUOTE_MODULE.screenManage,
    primaryKey: "Id",
    filterId: query.filterId ?? null,
    filterValues: query.filterValues,
    fullTextSearch: query.fullTextSearch ?? "",
    pageNumber: query.pageNumber ?? 0,
    pageSize: query.pageSize ?? 25,
    sortColumn: query.sortColumn ?? "modifieddate",
    sortOrder: query.sortOrder ?? true,
  });
  return { Data: page.rows, TotalCount: page.total };
}

/** View Quote header + related payload. Response `Value` is a JSON string. */
export async function getQuoteDetail(quoteId: string): Promise<TebQuoteHeader> {
  const envelope = await acGetData({
    Module: QUOTE_MODULE.estimation,
    Code: QUOTE_MODULE.screenAdd,
    PrimaryKey: quoteId,
    Data: "",
    Action: QUOTE_ACTION.getDetail,
  });
  return parseQuoteValue(envelope);
}

/** Add/Edit form load (includes FORMTYPE). */
export async function getQuoteDetailForEdit(quoteId: string, formType = ""): Promise<TebQuoteHeader> {
  const envelope = await acGetData({
    Module: QUOTE_MODULE.estimation,
    Code: QUOTE_MODULE.screenAdd,
    PrimaryKey: quoteId,
    Data: JSON.stringify({ ID: "FORMTYPE", Value: formType }),
    Action: QUOTE_ACTION.getDetailEdit,
  });
  return parseQuoteValue(envelope);
}

/**
 * Save header (add or update). Live Add Quote ApiPost is DYNAMIC `AcAddDetail`
 * with ParamName `data` and Action `ADD`. `AcGetData` + ADD can return an Id
 * without writing field values (title saved as blank).
 */
export async function saveQuoteHeader(
  form: Record<string, unknown>,
  quoteId = "",
  action: string = QUOTE_ACTION.add,
): Promise<string> {
  const payload: TebAcGetDataRequest = {
    Module: QUOTE_MODULE.estimation,
    Code: QUOTE_MODULE.screenAdd,
    PrimaryKey: quoteId || "",
    Data: JSON.stringify(form),
    Action: action,
  };
  const envelope = await acAddDetail(payload);
  if (envelope.Succeeded === false) {
    const message =
      Array.isArray(envelope.Messages) && envelope.Messages[0]
        ? envelope.Messages[0]
        : envelope.error || "Save failed";
    throw new TebApiError(message, 400, envelope);
  }
  const id = quoteIdFromEnvelope(envelope) || quoteId;
  return id;
}

function quoteIdFromEnvelope(envelope: TebApiEnvelope): string {
  const data = envelope.Data as Record<string, unknown> | string | undefined;
  const nested =
    data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
  const candidates = [
    envelope.value,
    envelope.Value,
    nested?.value,
    nested?.Value,
    nested?.Id,
    typeof data === "string" || typeof data === "number" ? data : null,
  ];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    const id = String(candidate).trim();
    if (id && id !== "null" && id !== "undefined") return id;
  }
  return "";
}

export async function getQuoteActivity(quoteId: string): Promise<unknown> {
  const envelope = await acGetData({
    Module: QUOTE_MODULE.estimation,
    Code: QUOTE_MODULE.screenAdd,
    PrimaryKey: quoteId,
    Data: "",
    Action: QUOTE_ACTION.getActivity,
  });
  return parseMaybeJson(envelope.Value ?? envelope.Data);
}

export async function getQuoteModuleSetting(): Promise<unknown> {
  const envelope = await tebRequest("COMPANY", "FnGetQuoteModuleSetting");
  return envelope.value ?? envelope.Data;
}

export interface QuoteModuleFlags {
  showAllCompanies: boolean;
  editContact: boolean;
  quoteFor?: string;
}

export function parseQuoteModuleFlags(raw: unknown): QuoteModuleFlags {
  const rows = Array.isArray(raw) ? raw : [];
  const flags: QuoteModuleFlags = { showAllCompanies: false, editContact: false };
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { Type?: string; Data?: unknown };
    const type = String(item.Type ?? "");
    const data = item.Data;
    if (type === "AllCompany" && String(data) === "Active") flags.showAllCompanies = true;
    if (type === "ChangeContact" && String(data) === "Active") flags.editContact = true;
    if (type === "QuoteFor") flags.quoteFor = data != null ? String(data) : undefined;
  }
  return flags;
}

function mergeQuoteDefaultRow(map: Record<string, unknown>, row: unknown): void {
  if (!row || typeof row !== "object") return;
  const control = row as { Control?: string; ControlName?: string; Value?: unknown };
  const name = control.Control || control.ControlName;
  if (!name) return;
  map[name] = parseMaybeJson(control.Value);
}

/** Blank-add defaults: site, workflow, currency, owner, optional company/contact. */
export async function getQuoteDefaults(formType = ""): Promise<Record<string, unknown>> {
  const envelope = await acGetData({
    Module: QUOTE_MODULE.estimation,
    Code: QUOTE_MODULE.screenAdd,
    PrimaryKey: "",
    Data: JSON.stringify({ ID: "FORMTYPE", Value: formType }),
    Action: QUOTE_ACTION.quoteDefault,
  });
  const parsed = parseMaybeJson(envelope.Value ?? envelope.value ?? envelope.Data);
  const map: Record<string, unknown> = {};

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.Data) || Array.isArray(obj.value)) {
      const rows = (Array.isArray(obj.Data) ? obj.Data : obj.value) as unknown[];
      if (rows.some((row) => row && typeof row === "object" && "Heading" in (row as object))) {
        for (const heading of rows) {
          if (!heading || typeof heading !== "object") continue;
          const block = heading as { Heading?: string; Data?: unknown };
          if (String(block.Heading ?? "").toUpperCase() === "ITEMS") continue;
          const nested = Array.isArray(block.Data) ? block.Data : [];
          nested.forEach((row) => mergeQuoteDefaultRow(map, row));
        }
      } else {
        rows.forEach((row) => mergeQuoteDefaultRow(map, row));
      }
    }
    const fieldKeys = ["LocationId", "WorkFlowId", "WorkflowId", "CurrencyId", "OwnerId", "SiteId", "CompanyId", "ContactId"];
    for (const key of fieldKeys) {
      if (map[key] == null && obj[key] != null) map[key] = obj[key];
    }
    if (Object.keys(map).length > 0) return map;
  }

  const headings = Array.isArray(parsed) ? parsed : [];
  for (const heading of headings) {
    if (!heading || typeof heading !== "object") continue;
    const block = heading as { Heading?: string; Data?: unknown; Control?: string };
    if (String(block.Heading ?? "").toUpperCase() === "ITEMS") continue;
    if (block.Control) {
      mergeQuoteDefaultRow(map, heading);
      continue;
    }
    const rows = Array.isArray(block.Data) ? block.Data : [];
    rows.forEach((row) => mergeQuoteDefaultRow(map, row));
  }
  return map;
}

export async function quoteAutocomplete(keyword: string, isAll = false): Promise<unknown> {
  const suffix = `gateway/quote/quoteautocomplete?Keyword=${encodeURIComponent(keyword)}&IsAll=${isAll}`;
  const envelope = await tebRequest("MICRO", suffix, { method: "GET" });
  return envelope.Data ?? envelope.value ?? envelope;
}

function parseQuoteValue(envelope: TebApiEnvelope): TebQuoteHeader {
  const parsed = parseMaybeJson(envelope.Value ?? envelope.Data ?? envelope.value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as TebQuoteHeader;
  }
  return {};
}

export function statusesFromQuote(header: TebQuoteHeader | null | undefined): { id: string; label: string }[] {
  if (!header) return [];
  const raw = header.WorkFlowDetail;
  if (raw == null || raw === "") return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const workflow = list[0] as
      | { WorkFlowSteps?: Array<Record<string, unknown>>; Status?: Array<Record<string, unknown>> }
      | undefined;
    const steps = workflow?.WorkFlowSteps ?? workflow?.Status ?? [];
    if (!Array.isArray(steps)) return [];
    return steps
      .map((row) => {
        const id = String(row.StatusId ?? row.Code ?? row.Id ?? "").trim();
        const label = String(row.Title ?? row.Status ?? row.Name ?? row.Text ?? "").trim();
        return id && label ? { id, label } : null;
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  } catch {
    return [];
  }
}

export async function changeQuoteStatus(input: {
  quoteId: string;
  workflowId: string;
  statusId: string;
  assigneeId?: string;
}): Promise<void> {
  const data = JSON.stringify({
    QuoteId: input.quoteId,
    WorkFlowId: input.workflowId,
    StatusId: input.statusId,
    AssigneeId: input.assigneeId ? [input.assigneeId] : [],
    FromPipeline: false,
    Notes: "",
  });
  // Live Tw.QUOTE is EstimationManagement. Code is the QUOTESTATUS screen, Action CHANGEQUOTESTATUS.
  const attempts: TebAcGetDataRequest[] = [
    { Module: QUOTE_MODULE.estimation, Code: "QUOTESTATUS", PrimaryKey: "", Data: data, Action: QUOTE_ACTION.changeStatus },
    { Module: QUOTE_MODULE.estimation, Code: "QUOTESTATUS", PrimaryKey: input.quoteId, Data: data, Action: QUOTE_ACTION.changeStatus },
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_ACTION.changeStatus, PrimaryKey: input.quoteId, Data: data, Action: QUOTE_ACTION.changeStatus },
  ];
  let lastError: unknown = null;
  for (const payload of attempts) {
    try {
      const envelope = await acAddDetail(payload);
      if (envelope.Succeeded === false) {
        lastError = new TebApiError(envelopeMessage(envelope, "Could not change quote status."), 400, envelope);
        continue;
      }
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new TebApiError("Could not change quote status.", 400);
}

export function statusFromQuote(header: TebQuoteHeader | null | undefined): string {
  if (!header) return "";
  const direct = [
    header.Status,
    header.StatusName,
    header.CurrentStatus,
    header.ParentValue,
    header.WorkFlow,
  ].find(
    (value) => value != null && String(value).trim() !== "" && String(value) !== "null",
  );
  if (direct) return String(direct);
  const raw = header.WorkFlowDetail;
  if (raw == null || raw === "") return "";
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const workflow = list[0] as
      | { Title?: string; WorkFlowSteps?: Array<{ Code?: string; Title?: string; StatusId?: string }> }
      | undefined;
    const statusId = String(header.StatusId ?? header.CurrentStatusId ?? "");
    const step = workflow?.WorkFlowSteps?.find(
      (row) => row.Code === statusId || row.StatusId === statusId,
    );
    return step?.Title || workflow?.Title || "";
  } catch {
    return "";
  }
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export type QuoteViewActionId =
  | "edit"
  | "delete"
  | "revise"
  | "archive"
  | "copy"
  | "sendMail"
  | "viewTemplate"
  | "addItem"
  | "removeItem"
  | "updateItem"
  | "terms"
  | "addNote"
  | "viewNotes"
  | "addAction";

export interface QuoteViewPermissions {
  edit: boolean;
  delete: boolean;
  revise: boolean;
  archive: boolean;
  copy: boolean;
  sendMail: boolean;
  viewTemplate: boolean;
  addItem: boolean;
  removeItem: boolean;
  updateItem: boolean;
  terms: boolean;
  addNote: boolean;
  viewNotes: boolean;
  addAction: boolean;
  codes: string[];
}

/** Live ITEMCONSUMEPERMISSION / Consent codes (`a.wB`) plus VIEWTOOLBAR ActionType values. */
const VIEW_ACTION_ALIASES: Record<QuoteViewActionId, string[]> = {
  edit: ["EDITQUT", "EDITQUOTE"],
  delete: ["DELQUT", "DELQUOTE"],
  revise: ["REVISE", "REV"],
  archive: ["ARCHIVE", "ARC", "ARCHIVES"],
  copy: ["COPYQUOTE", "COPYQUOT"],
  sendMail: ["SENMAIL", "SENDMAIL", "QUOTEMAIL"],
  viewTemplate: ["VIEWTEMPLATE", "SAVETEMPLATE", "DOWNLOADTEMPLATE", "EXPORTPDF", "UPTEMP"],
  addItem: ["ADDEDITITEM"],
  removeItem: ["DELETEITEM", "ITEMDEL", "REMOVEITEM"],
  updateItem: ["UPPRICE", "CHANGEPRICE", "TOTDISC", "ADDEDITITEM"],
  terms: ["TERMSCOPE"],
  addNote: ["NOTE"],
  viewNotes: ["VIEWNOTE", "NOTE"],
  addAction: ["ACTION"],
};

/** Denied until this user's VIEWTOOLBAR / Consent / ITEMCONSUMEPERMISSION load. */
export function emptyQuoteViewPermissions(): QuoteViewPermissions {
  return {
    edit: false,
    delete: false,
    revise: false,
    archive: false,
    copy: false,
    sendMail: false,
    viewTemplate: false,
    addItem: false,
    removeItem: false,
    updateItem: false,
    terms: false,
    addNote: false,
    viewNotes: false,
    addAction: false,
    codes: [],
  };
}

/** New unsaved quote: the creator can compose until the first permission reload. */
export function defaultQuoteViewPermissions(): QuoteViewPermissions {
  return {
    ...emptyQuoteViewPermissions(),
    edit: true,
    addItem: true,
    removeItem: true,
    updateItem: true,
    terms: true,
    addNote: true,
    viewNotes: true,
    addAction: true,
    sendMail: true,
    viewTemplate: true,
  };
}

function truthyFlag(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (value === true || value === 1 || value === "1" || value === "true" || value === "True" || value === "YES") {
    return true;
  }
  if (value === false || value === 0 || value === "0" || value === "false" || value === "False" || value === "NO") {
    return false;
  }
  return undefined;
}

function pushCode(codes: string[], value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text || text === "NULL" || codes.includes(text)) return;
  codes.push(text);
}

function collectActionCodes(raw: unknown, codes: string[] = []): string[] {
  if (raw == null || raw === "") return codes;
  const parsed = parseMaybeJson(raw);
  if (typeof parsed === "string") {
    pushCode(codes, parsed);
    return codes;
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectActionCodes(item, codes);
    return codes;
  }
  if (parsed && typeof parsed === "object") {
    const row = parsed as Record<string, unknown>;
    pushCode(codes, row.Code ?? row.Action ?? row.ActionType ?? row.ActionCode ?? row.Type);
    for (const value of Object.values(row)) {
      if (value && typeof value === "object") collectActionCodes(value, codes);
    }
  }
  return codes;
}

function codesHave(codes: string[], aliases: string[]): boolean {
  const set = new Set(codes.map((code) => code.toUpperCase()));
  return aliases.some((alias) => set.has(alias.toUpperCase()));
}

function codesAllow(codes: string[], action: QuoteViewActionId): boolean {
  return codesHave(codes, VIEW_ACTION_ALIASES[action]);
}

function uniqueCodes(...groups: string[][]): string[] {
  const codes: string[] = [];
  for (const group of groups) {
    for (const code of group) pushCode(codes, code);
  }
  return codes;
}

function notesCountFromHeader(header?: TebQuoteHeader | null): number {
  if (!header) return 0;
  const value = header.Notes ?? header.Note;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function flagsFromQuoteHeader(header?: TebQuoteHeader | null): Partial<QuoteViewPermissions> {
  if (!header) return {};
  const flags: Partial<QuoteViewPermissions> = {};
  const edit = truthyFlag(header.EditPermission ?? header.IsEdit ?? header.AllowEdit);
  const del = truthyFlag(header.DeletePermission ?? header.IsDelete ?? header.AllowDelete);
  const revise = truthyFlag(header.RevisePermission ?? header.IsRevise);
  const archive = truthyFlag(header.ArchivePermission ?? header.IsArchive);
  const copy = truthyFlag(header.CopyPermission ?? header.IsCopy);
  const note = truthyFlag(header.NotePermission);
  const action = truthyFlag(header.ActionPermission);
  if (edit != null) flags.edit = edit;
  if (del != null) flags.delete = del;
  if (revise != null) flags.revise = revise;
  if (archive != null) flags.archive = archive;
  if (copy != null) flags.copy = copy;
  if (note != null) {
    flags.viewNotes = note;
    flags.addNote = note;
  }
  if (action != null) flags.addAction = action;
  if (notesCountFromHeader(header) > 0) flags.viewNotes = true;
  return flags;
}

function applyConsumeCodes(target: QuoteViewPermissions, codes: string[]) {
  if (codes.length === 0) return;
  target.addItem = codesAllow(codes, "addItem");
  target.removeItem = codesAllow(codes, "removeItem");
  target.updateItem = codesAllow(codes, "updateItem");
  target.terms = codesAllow(codes, "terms");
  target.addNote = codesAllow(codes, "addNote");
  target.viewNotes = codesAllow(codes, "viewNotes") || target.viewNotes;
  target.addAction = codesAllow(codes, "addAction");
  if (codesAllow(codes, "viewTemplate")) target.viewTemplate = true;
}

/**
 * Permissions for the logged-in user on this quote at its current stage.
 * VIEWTOOLBAR, GETQUOTEDETAIL.Consent, and ITEMCONSUMEPERMISSION are user-specific.
 * Workflow-step IsEdit is the same for everyone on a stage — do not use it to grant access.
 */
export function quoteViewPermissionsFrom(
  toolbar: unknown,
  header?: TebQuoteHeader | null,
  consumePermission?: unknown,
): QuoteViewPermissions {
  const next = emptyQuoteViewPermissions();
  const headerFlags = flagsFromQuoteHeader(header);
  const toolbarCodes = collectActionCodes(toolbar);
  const consumeCodes = collectActionCodes(consumePermission);
  const consentCodes = collectActionCodes(header?.Consent);
  const viewPermCodes = collectActionCodes(header?.ViewPermission);
  next.codes = uniqueCodes(toolbarCodes, consumeCodes, consentCodes, viewPermCodes);

  next.edit = headerFlags.edit ?? false;
  next.delete = headerFlags.delete ?? false;
  next.revise = headerFlags.revise ?? false;
  next.archive = headerFlags.archive ?? false;
  next.copy = headerFlags.copy ?? false;
  next.viewNotes = headerFlags.viewNotes ?? false;
  next.addNote = headerFlags.addNote ?? false;
  next.addAction = headerFlags.addAction ?? false;

  applyConsumeCodes(next, viewPermCodes);
  applyConsumeCodes(next, consentCodes);
  applyConsumeCodes(next, consumeCodes);

  if (toolbarCodes.length > 0) {
    const blob = JSON.stringify(toolbar ?? "").toUpperCase();
    next.edit = codesAllow(toolbarCodes, "edit");
    next.delete = codesAllow(toolbarCodes, "delete") || codesHave(toolbarCodes, ["DELETE"]);
    next.revise = codesAllow(toolbarCodes, "revise");
    next.archive = codesAllow(toolbarCodes, "archive");
    next.copy = codesAllow(toolbarCodes, "copy") || codesHave(toolbarCodes, ["COPY"]);
    next.sendMail =
      codesAllow(toolbarCodes, "sendMail") ||
      blob.includes("SENMAIL") ||
      blob.includes("SENDMAIL") ||
      blob.includes("QUOTEMAIL");
    if (codesAllow(toolbarCodes, "viewTemplate") || blob.includes("EXPORTPDF") || blob.includes("VIEWTEMPLATE")) {
      next.viewTemplate = true;
    }
  }

  const hasItemSource = consumeCodes.length > 0 || consentCodes.length > 0 || viewPermCodes.length > 0;
  if (!hasItemSource && next.edit) {
    next.addItem = true;
    next.removeItem = true;
    next.updateItem = true;
    next.terms = true;
  }

  if (notesCountFromHeader(header) > 0) next.viewNotes = true;
  return next;
}

function envelopeMessage(envelope: TebApiEnvelope, fallback: string): string {
  if (Array.isArray(envelope.Messages) && envelope.Messages[0]) return String(envelope.Messages[0]);
  return envelope.error || envelope.message || envelope.Message || fallback;
}

export async function getQuoteViewToolbar(quoteId: string): Promise<unknown> {
  const attempts: Array<{ Module: string; Code: string; FilterModule: string }> = [
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_MODULE.screenView, FilterModule: QUOTE_MODULE.tebQuote },
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_MODULE.screenAdd, FilterModule: QUOTE_MODULE.tebQuote },
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_MODULE.screenView, FilterModule: "SALES" },
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_MODULE.screenAdd, FilterModule: "SALES" },
  ];
  for (const attempt of attempts) {
    const payload: TebAcGetDataRequest = {
      Module: attempt.Module,
      Code: attempt.Code,
      PrimaryKey: quoteId,
      Data: "",
      Action: QUOTE_ACTION.viewToolbar,
      FilterModule: attempt.FilterModule,
      FilterId: "",
    };
    for (const send of [acGetData, acAddDetail] as const) {
      try {
        const envelope = await send(payload);
        const parsed = parseMaybeJson(envelope.Value ?? envelope.value ?? envelope.Data);
        if (parsed != null && parsed !== "") return parsed;
      } catch {
        // Try the next live Method / Code / FilterModule pair.
      }
    }
  }
  return null;
}

async function getQuoteViewPermissionCodes(quoteId: string): Promise<unknown> {
  const attempts: TebAcGetDataRequest[] = [
    { Module: QUOTE_MODULE.screenAdd, Code: "", PrimaryKey: quoteId, Data: "", Action: "ITEMCONSUMEPERMISSION" },
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_MODULE.screenAdd, PrimaryKey: quoteId, Data: "", Action: "ITEMCONSUMEPERMISSION" },
    { Module: QUOTE_MODULE.estimation, Code: QUOTE_MODULE.screenView, PrimaryKey: quoteId, Data: "", Action: "ITEMCONSUMEPERMISSION" },
  ];
  for (const payload of attempts) {
    try {
      const envelope = await acGetData(payload);
      const parsed = parseMaybeJson(envelope.Value ?? envelope.value ?? envelope.Data);
      if (parsed != null && parsed !== "") return parsed;
    } catch {
      // Try the next live ITEMCONSUMEPERMISSION shape.
    }
  }
  return null;
}

export async function loadQuoteViewPermissions(
  quoteId: string,
  header?: TebQuoteHeader | null,
): Promise<QuoteViewPermissions> {
  const [toolbar, viewPermission] = await Promise.all([
    getQuoteViewToolbar(quoteId).catch(() => null),
    getQuoteViewPermissionCodes(quoteId).catch(() => null),
  ]);
  return quoteViewPermissionsFrom(toolbar, header, viewPermission);
}

async function postQuoteAction(input: {
  action: string;
  quoteId: string;
  data?: string;
  useAdd?: boolean;
}): Promise<TebApiEnvelope> {
  const payload: TebAcGetDataRequest = {
    Module: QUOTE_MODULE.estimation,
    Code: QUOTE_MODULE.screenAdd,
    PrimaryKey: JSON.stringify({ key: [input.quoteId], ModuleName: false }),
    Data: input.data ?? "",
    Action: input.action,
    ComponentCode: QUOTE_MODULE.screenAdd,
  };
  if (input.useAdd) return acAddDetail(payload);
  try {
    return await acAddDetail(payload);
  } catch (err) {
    const status = err instanceof TebApiError ? err.status : 0;
    if (status >= 400 && status < 500 && status !== 404) throw err;
    return acGetData({
      ...payload,
      PrimaryKey: input.quoteId,
    });
  }
}

export async function checkQuoteDeletePermission(quoteId: string): Promise<{ allowed: boolean; message: string }> {
  try {
    const envelope = await tebRequest<TebApiEnvelope>("MICRO", "gateway/order/ValidateOrderEntity", {
      method: "POST",
      body: { EntityIds: [quoteId], Type: QUOTE_MODULE.estimation },
    });
    if (envelope.Succeeded === false) {
      return { allowed: false, message: envelopeMessage(envelope, "You cannot delete this quote.") };
    }
    if (envelope.Succeeded === true) return { allowed: true, message: "" };
  } catch {
    // Fall through to CHECKDELETEPERMISSION.
  }
  try {
    const envelope = await acGetData({
      Module: QUOTE_MODULE.estimation,
      Code: QUOTE_MODULE.screenAdd,
      PrimaryKey: JSON.stringify({ key: [quoteId], ModuleName: false }),
      Data: "",
      Action: QUOTE_ACTION.checkDeletePermission,
      ComponentCode: QUOTE_MODULE.screenAdd,
    });
    if (envelope.Succeeded === false) {
      return { allowed: false, message: envelopeMessage(envelope, "You cannot delete this quote.") };
    }
  } catch (err) {
    if (err instanceof TebApiError && err.status < 500) {
      return { allowed: false, message: err.message };
    }
  }
  return { allowed: true, message: "" };
}

export async function deleteQuote(quoteId: string): Promise<void> {
  const check = await checkQuoteDeletePermission(quoteId);
  if (!check.allowed) throw new TebApiError(check.message, 400);
  const envelope = await postQuoteAction({ action: QUOTE_ACTION.delete, quoteId });
  if (envelope.Succeeded === false) {
    throw new TebApiError(envelopeMessage(envelope, "Could not delete the quote."), 400, envelope);
  }
}

export async function copyQuote(quoteId: string): Promise<string> {
  const detail = await getQuoteDetailForEdit(quoteId);
  const form: Record<string, unknown> = {
    ...detail,
    Id: "",
    IsCopyDocuments: true,
  };
  return saveQuoteHeader(form, quoteId, QUOTE_ACTION.copy);
}

export async function reviseQuote(quoteId: string): Promise<string> {
  const envelope = await postQuoteAction({
    action: QUOTE_ACTION.revise,
    quoteId,
    data: JSON.stringify({ QuoteId: quoteId }),
    useAdd: true,
  });
  if (envelope.Succeeded === false) {
    throw new TebApiError(envelopeMessage(envelope, "Could not revise the quote."), 400, envelope);
  }
  const id = quoteIdFromEnvelope(envelope);
  if (id && id !== quoteId) return id;
  return copyQuote(quoteId);
}

export async function archiveQuote(quoteId: string): Promise<void> {
  let last: TebApiEnvelope | null = null;
  for (const action of [QUOTE_ACTION.archive, "ARCHIVE"]) {
    try {
      const envelope = await postQuoteAction({
        action,
        quoteId,
        data: JSON.stringify({ QuoteId: quoteId }),
        useAdd: true,
      });
      last = envelope;
      if (envelope.Succeeded === false) continue;
      return;
    } catch (err) {
      if (err instanceof TebApiError && err.status >= 500) throw err;
      last = err instanceof TebApiError ? err.payload ?? null : null;
    }
  }
  throw new TebApiError(
    last ? envelopeMessage(last, "Could not archive the quote.") : "Could not archive the quote.",
    400,
    last ?? undefined,
  );
}
