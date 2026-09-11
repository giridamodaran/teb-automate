import type { ReportColumn, ReportEntityKey } from "@/lib/chat/types";

export type { ReportEntityKey };

export interface ReportEntity {
  key: ReportEntityKey;
  title: string;
  plural: string;
  keywords: string[];
  dynamicModule: string;
  listModule: string;
  workflowModules: string[];
  reportingMethod?: string;
  managePath: string;
  viewPath?: (id: string) => string;
  columns: ReportColumn[];
}

const MONEY_COLS: ReportColumn[] = [
  { key: "OwnerName", title: "Owner" },
  { key: "Status", title: "Status" },
  { key: "TotalAmount", title: "Amount", kind: "money" },
  { key: "CreatedDate", title: "Created", kind: "date" },
];

export const REPORT_ENTITIES: Record<ReportEntityKey, ReportEntity> = {
  quote: {
    key: "quote",
    title: "Quote",
    plural: "quotes",
    keywords: ["quotations", "quotation", "quotes", "quote"],
    dynamicModule: "EstimationManagement",
    listModule: "TEBQuote",
    workflowModules: ["TEBQuote", "EstimationManagement", "SalesManagement"],
    reportingMethod: "GetTeamBasedQuoteDetails",
    managePath: "/sales/quote/manage",
    viewPath: (id) => `/sales/quote/view/${id}`,
    columns: [
      { key: "QuoteTitle", title: "Title" },
      { key: "QuoteCode", title: "Code" },
      { key: "CompanyName", title: "Company" },
      ...MONEY_COLS.map((col) => (col.key === "TotalAmount" ? { ...col, key: "NetAmount" } : col)),
    ],
  },
  lead: {
    key: "lead",
    title: "Lead",
    plural: "leads",
    keywords: ["leads", "lead"],
    dynamicModule: "LeadManagement",
    listModule: "TEBLead",
    workflowModules: ["TEBLead", "LeadManagement", "SalesManagement"],
    reportingMethod: "GetTeamBasedLeadDetails",
    managePath: "/sales/lead/manage",
    columns: [
      { key: "Title", title: "Title" },
      { key: "CompanyName", title: "Company" },
      { key: "OwnerName", title: "Owner" },
      { key: "Status", title: "Status" },
      { key: "Priority", title: "Priority" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
  opportunity: {
    key: "opportunity",
    title: "Opportunity",
    plural: "opportunities",
    keywords: ["opportunities", "opportunity", "opprotunity", "opps", "deals", "deal"],
    dynamicModule: "SalesManagement",
    listModule: "TEBSale",
    workflowModules: ["TEBSale", "SalesManagement"],
    reportingMethod: "GetTeamBasedOpportunityDetails",
    managePath: "/sales/opportunity/manage",
    columns: [
      { key: "Title", title: "Title" },
      { key: "CompanyName", title: "Company" },
      { key: "OwnerName", title: "Owner" },
      { key: "Status", title: "Status" },
      { key: "Amount", title: "Amount", kind: "money" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
  order: {
    key: "order",
    title: "Order",
    plural: "orders",
    keywords: ["sales orders", "sales order", "orders", "order"],
    dynamicModule: "OrderManagement",
    listModule: "TEBOrder",
    workflowModules: ["TEBOrder", "OrderManagement", "SalesManagement"],
    reportingMethod: "GetTeamBasedOrderDetails",
    managePath: "/sales/order/manage",
    columns: [
      { key: "Title", title: "Title" },
      { key: "OrderCode", title: "Code" },
      { key: "CompanyName", title: "Company" },
      ...MONEY_COLS,
    ],
  },
  invoice: {
    key: "invoice",
    title: "Invoice",
    plural: "invoices",
    keywords: ["invoices", "invoice", "bills", "bill"],
    dynamicModule: "InvoiceManagement",
    listModule: "TEBInvoice",
    workflowModules: ["TEBInvoice", "InvoiceManagement"],
    reportingMethod: "GetTeamBasedInvoiceDetails",
    managePath: "/finance/invoice/manage",
    columns: [
      { key: "Title", title: "Title" },
      { key: "InvoiceCode", title: "Code" },
      { key: "CompanyName", title: "Company" },
      ...MONEY_COLS,
    ],
  },
  ticket: {
    key: "ticket",
    title: "Service ticket",
    plural: "service tickets",
    keywords: ["service tickets", "service ticket", "tickets", "ticket"],
    dynamicModule: "TicketManagement",
    listModule: "TEBTicket",
    workflowModules: ["TEBTicket", "TicketManagement"],
    reportingMethod: "GetTeamBasedTicketDetails",
    managePath: "/service/ticket/manage",
    viewPath: (id) => `/service/ticket/view/${id}`,
    columns: [
      { key: "Title", title: "Title" },
      { key: "TicketCode", title: "Code" },
      { key: "CompanyName", title: "Company" },
      { key: "OwnerName", title: "Owner" },
      { key: "Status", title: "Status" },
      { key: "Priority", title: "Priority" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
  workorder: {
    key: "workorder",
    title: "Work order",
    plural: "work orders",
    keywords: ["work orders", "work order", "workorders", "workorder"],
    dynamicModule: "WorkOrderManagement",
    listModule: "TEBWorkorder",
    workflowModules: ["TEBWorkorder", "WorkOrderManagement", "WorkorderManagement"],
    reportingMethod: "GetTeamBasedWorkorderDetails",
    managePath: "/service/workorder/manage",
    viewPath: (id) => `/service/workorder/view/${id}`,
    columns: [
      { key: "Title", title: "Title" },
      { key: "WorkOrderCode", title: "Code" },
      { key: "CompanyName", title: "Company" },
      { key: "Priority", title: "Priority" },
      ...MONEY_COLS,
    ],
  },
  workforce: {
    key: "workforce",
    title: "Workforce",
    plural: "workforce",
    keywords: ["work force", "workforce", "wforce", "field team", "my team", "team members", "find my team", "route"],
    dynamicModule: "WorkForceManagement",
    listModule: "TEBWorkforce",
    workflowModules: ["TEBWorkforce", "WorkForceManagement", "WorkForeceManagement"],
    managePath: "/workforce/team",
    columns: [
      { key: "FullName", title: "Name" },
      { key: "Email", title: "Email" },
      { key: "Address", title: "Location" },
      { key: "Status", title: "Status" },
      { key: "CreatedDate", title: "Started", kind: "date" },
    ],
  },
  action: {
    key: "action",
    title: "Action",
    plural: "actions",
    keywords: ["actions", "action", "my day"],
    dynamicModule: "ActionManagement",
    listModule: "TEBAction",
    workflowModules: ["TEBAction", "ActionManagement"],
    reportingMethod: "GetTeamAndMemberBasedActionDetails",
    managePath: "/action/manage",
    viewPath: (id) => `/sales/action/view/${id}`,
    columns: [
      { key: "Title", title: "Title" },
      { key: "CompanyName", title: "Company" },
      { key: "OwnerName", title: "Owner" },
      { key: "Status", title: "Status" },
      { key: "ScheduledDate", title: "When", kind: "date" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
  receipt: {
    key: "receipt",
    title: "Receipt",
    plural: "receipts",
    keywords: ["receipts", "receipt", "collections", "amount received"],
    dynamicModule: "InvoiceManagement",
    listModule: "TEBInvoice",
    workflowModules: ["TEBInvoice", "InvoiceManagement"],
    reportingMethod: "GetTeamBasedInvoiceDetails",
    managePath: "/finance/invoice/manage",
    columns: [
      { key: "Title", title: "Title" },
      { key: "InvoiceCode", title: "Code" },
      { key: "CompanyName", title: "Company" },
      { key: "OwnerName", title: "Owner" },
      { key: "Status", title: "Status" },
      { key: "AmountReceived", title: "Received", kind: "money" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
  company: {
    key: "company",
    title: "Company",
    plural: "companies",
    keywords: [
      "companies",
      "company profile",
      "company profiles",
      "find company",
      "search company",
      "view company",
      "list companies",
      "accounts",
    ],
    dynamicModule: "TEBBusiness",
    listModule: "TEBBusiness",
    workflowModules: ["TEBContact", "TEBBusiness", "BusinessContactManagement"],
    managePath: "/sales/company/manage",
    viewPath: (id) => `/sales/company/view/${id}`,
    columns: [
      { key: "CompanyName", title: "Company" },
      { key: "CompanyCode", title: "Code" },
      { key: "OwnerName", title: "Owner" },
      { key: "IndustryName", title: "Industry" },
      { key: "LocationName", title: "Location" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
  contact: {
    key: "contact",
    title: "Contact",
    plural: "contacts",
    keywords: [
      "contacts",
      "contact profile",
      "contact profiles",
      "find contact",
      "search contact",
      "view contact",
      "list contacts",
    ],
    dynamicModule: "TEBPeople",
    listModule: "TEBPeople",
    workflowModules: ["TEBContact", "TEBPeople", "BusinessContactManagement"],
    managePath: "/sales/contact/manage",
    viewPath: (id) => `/sales/contact/view/${id}`,
    columns: [
      { key: "FullName", title: "Name" },
      { key: "CompanyName", title: "Company" },
      { key: "OwnerName", title: "Owner" },
      { key: "JobTitle", title: "Job title" },
      { key: "LocationName", title: "Location" },
      { key: "CreatedDate", title: "Created", kind: "date" },
    ],
  },
};

export function entityFromPath(pathname: string): ReportEntityKey | undefined {
  if (/\/ticket\//i.test(pathname)) return "ticket";
  if (/\/workorder\//i.test(pathname) || /\/work-order\//i.test(pathname)) return "workorder";
  if (/\/action\//i.test(pathname)) return "action";
  if (/\/workforce\//i.test(pathname) || /\/wforce\//i.test(pathname) || /\/tracking\//i.test(pathname)) {
    return "workforce";
  }
  if (/\/receipt\//i.test(pathname)) return "receipt";
  if (/\/contact\//i.test(pathname)) return "contact";
  if (/\/company\//i.test(pathname) || /\/business\//i.test(pathname)) return "company";
  if (/\/quote\//i.test(pathname)) return "quote";
  if (/\/lead\//i.test(pathname)) return "lead";
  if (/\/opportunit/i.test(pathname)) return "opportunity";
  if (/\/invoice\//i.test(pathname)) return "invoice";
  if (/\/order\//i.test(pathname)) return "order";
  return undefined;
}

function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

/** Longest keyword wins so “work order” is not treated as a sales order. */
export function findEntityByKeyword(text: string): ReportEntityKey | undefined {
  let best: { key: ReportEntityKey; length: number } | undefined;
  for (const entity of Object.values(REPORT_ENTITIES)) {
    for (const keyword of entity.keywords) {
      if (!keywordPattern(keyword).test(text)) continue;
      if (!best || keyword.length > best.length) best = { key: entity.key, length: keyword.length };
    }
  }
  return best?.key;
}
