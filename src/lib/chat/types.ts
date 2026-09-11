export type ReportEntityKey =
  | "quote"
  | "lead"
  | "opportunity"
  | "order"
  | "invoice"
  | "ticket"
  | "workorder"
  | "workforce"
  | "action"
  | "receipt"
  | "company"
  | "contact";

export type WorkforceTopic = "team" | "location" | "route" | "started" | "joined";
export type PartyTopic = "list" | "profile" | "search";
export type QuoteTopic = "list" | "view";

export type ReportStack = "list" | "count" | "dashboard";
export type ReportMetric = "count" | "value";

export type DateFieldType =
  | "CREATEDFILTER"
  | "UPDATEDFILTER"
  | "NOTUPDATEDFILTER"
  | "CLOSEDFILTER"
  | "SCHEDULEFILTER"
  | "DUEFILTER";

/** Live date-criteria Codes on the Created Filter panel. */
export type DateMode = "ANY" | "WITHIN" | "BETWEEN" | "FINANCIALPERIOD";

export type DatePeriodType = "FILTERDAYS" | "FILTERMONTHS" | "FILTERYEARS";

export interface DateRangeIntent {
  fieldType: DateFieldType;
  mode: DateMode;
  label: string;
  from?: string;
  to?: string;
  period?: number;
  periodType?: DatePeriodType;
  anyUpdatePeriodType?: "LAST" | "NEXT";
  financePeriod?: string;
}

export interface LiveDateFilter {
  FieldType: DateFieldType;
  Mode: DateMode;
  DateRange: { FromDate: string | null; ToDate: string | null };
  DatePeriod: { Period: number; PeriodType: string };
  AnyUpdate: {
    UpdateOn: string[];
    PeriodType: "LAST" | "NEXT" | "";
    IsNotUpdate: boolean;
  };
  FinancePeriod: string;
}

export interface FilterCriterion {
  key: string;
  values: string[];
  me?: boolean;
}

export interface ReportIntent {
  raw: string;
  entity?: ReportEntityKey;
  stack: ReportStack;
  metric: ReportMetric;
  chart?: "bar" | "pie" | "line";
  ownerMe: boolean;
  ownerName?: string;
  assigneeMe: boolean;
  assigneeName?: string;
  locationName?: string;
  stageNames: string[];
  workflowName?: string;
  search?: string;
  date?: DateRangeIntent;
  savedFilterName?: string;
  useDefaultFilter?: boolean;
  listFilters?: boolean;
  criteria: FilterCriterion[];
  pageSize: number;
  workforceTopic?: WorkforceTopic;
  partyTopic?: PartyTopic;
  quoteTopic?: QuoteTopic;
  personName?: string;
}

export interface FilterTab {
  Code: string;
  Title?: string;
  TabViewType?: string;
  DbFieldName?: string;
  CustomControlType?: string;
  CustomFieldCode?: string;
  Fields?: string[];
  Data?: unknown;
}

export interface FilterControl {
  Code: string;
  Title?: string;
  DbFieldName?: string;
  ControlType?: string;
}

export interface FilterExtraApi {
  Code: string;
  ApiCall?: {
    Method?: string;
    Api?: string;
    Type?: string;
    ParamName?: Array<{ Name?: string; Property?: string; Type?: string }>;
  };
}

export interface FilterScreen {
  Tabs: FilterTab[];
  Controls: FilterControl[];
  ExtraApi: FilterExtraApi[];
}

export interface FilterValueRow {
  TabCode: string;
  PropertyName?: string;
  ControlType?: string;
  LabelName?: string;
  MultiValue?: string[];
  SelectedValue?: unknown;
  ValueContainers?: Array<{
    SingleValue?: string;
    MultiValue?: string[];
    Key?: string;
    Values?: string[];
  }>;
  DateFilter?: LiveDateFilter | null;
  IsCustomField?: boolean;
  SingleValue?: string;
  Operator?: string;
  DataType?: string;
}

export interface ReportingFilterDetail {
  FilterId: string;
  IsActive: boolean;
  FullTextSearch: string;
  WorkflowFilters: Array<{ WorkflowId: string; Stages: string[] }>;
  DateFilter: LiveDateFilter | Record<string, unknown>;
  LocationFilter: {
    Sites: string[];
    Cities: string[];
    Countries: string[];
    Counties: string[];
  };
  OwnerAssigneeFilter: { Owners: string[]; Assignees: string[] };
  Itemfilter: Record<string, unknown>;
  MasterFilter: Record<string, unknown>;
  CustomFieldFilters: unknown[];
  Apps: unknown[];
}

export interface PartyChannel {
  kind: "phone" | "email";
  title: string;
  value: string;
  href: string;
}

export interface PartyCard {
  id: string;
  kind: "company" | "contact";
  name: string;
  subtitle?: string;
  owner?: string;
  location?: string;
  industry?: string;
  phones: PartyChannel[];
  emails: PartyChannel[];
}

export interface PartyProfile extends PartyCard {
  fields: Array<{ label: string; value: string }>;
  related: PartyCard[];
  companyId?: string;
  companyName?: string;
}

export interface QuoteCard {
  id: string;
  title: string;
  code: string;
  company?: string;
  contact?: string;
  owner?: string;
  status?: string;
  amountFormatted?: string;
  openUrl: string;
}

export interface QuoteViewItem {
  id: string;
  name: string;
  sku?: string;
  quantity: string;
  unit?: string;
  unitPrice: string;
  discount: string;
  tax: string;
  netAmount: string;
  brand?: string;
  category?: string;
}

export interface QuoteViewLine {
  title: string;
  value: string;
  emphasis?: boolean;
}

export interface QuoteViewTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  isSelected: boolean;
  pdfUrl?: string;
}

export interface QuoteViewNote {
  id: string;
  text: string;
  author?: string;
  date?: string;
  pinned?: boolean;
}

export interface QuoteViewAction {
  id: string;
  type: string;
  assignee?: string;
  schedule?: string;
}

export interface QuoteView {
  id: string;
  title: string;
  code: string;
  company?: string;
  contact?: string;
  owner?: string;
  status?: string;
  workflow?: string;
  nextStatus?: string;
  closed?: boolean;
  currencySymbol: string;
  currencyCode: string;
  openUrl: string;
  fields: Array<{ label: string; value: string }>;
  items: QuoteViewItem[];
  itemNames: string[];
  templates: QuoteViewTemplate[];
  notes: QuoteViewNote[];
  actions: QuoteViewAction[];
  breakdown: QuoteViewLine[];
}

export interface ReportColumn {
  key: string;
  title: string;
  kind?: "string" | "date" | "money";
}

export interface ChartSeries {
  kind: "bar" | "pie" | "line";
  title: string;
  currencySymbol?: string;
  points: Array<{ label: string; value: number }>;
}

export interface DatasetSummary {
  total: number;
  shown: number;
  amount: number;
  metric: ReportMetric;
  currencySymbol: string;
  currencyCode: string;
  byStatus: Array<{ label: string; value: number }>;
  byOwner: Array<{ label: string; value: number }>;
  byMonth: Array<{ label: string; value: number }>;
  dateField: string;
  sample: Array<{ title: string; owner: string; status: string; amount: number; amountFormatted: string; date: string }>;
}

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  subtitle?: string;
  kind?: "pin" | "start" | "end";
}

export interface MapPath {
  points: Array<{ lat: number; lng: number }>;
  dotted?: boolean;
}

export interface ReportResult {
  text: string;
  analysis: string;
  chips: string[];
  total: number;
  amount: number;
  metric: ReportMetric;
  currencySymbol: string;
  currencyCode: string;
  rows: Record<string, unknown>[];
  columns: ReportColumn[];
  charts: ChartSeries[];
  map?: MapPin[];
  paths?: MapPath[];
  mapTitle?: string;
  summary?: DatasetSummary;
  entity?: ReportEntityKey;
  stack: ReportStack;
  partyCards?: PartyCard[];
  partyProfile?: PartyProfile;
  quoteCards?: QuoteCard[];
  quoteView?: QuoteView;
  viewHref?: (row: Record<string, unknown>) => string | null;
  suggestions?: string[];
  applied: {
    filterId: string | null;
    filterValues: FilterValueRow[] | null;
    fullTextSearch: string;
  };
}
