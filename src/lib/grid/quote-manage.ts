import { QUOTE_MODULE } from "@/lib/api/quote";
import type { GridColumnDef, GridViewContext } from "@/lib/grid/types";

export const QUOTE_GRID_CONTEXT: GridViewContext = {
  module: QUOTE_MODULE.estimation,
  screenCode: QUOTE_MODULE.screenManage,
};

export const QUOTE_LIST_MODULE = QUOTE_MODULE.estimation;
export const QUOTE_LIST_ACTION = QUOTE_MODULE.screenManage;

/** Bundled MANAGE GridColumn plus common server-catalog fields. */
export const QUOTE_MANAGE_COLUMNS: GridColumnDef[] = [
  { code: "QUOTETITLE", property: "QuoteTitle", title: "Title", dataType: "STRING", sortColumn: "quotetitle", widthClass: "min-w-64", primary: true },
  { code: "TITLE", property: "Title", title: "Title", dataType: "STRING", sortColumn: "title", widthClass: "min-w-64", primary: true },
  { code: "ID", property: "Id", title: "ID", dataType: "STRING", sortColumn: "id", widthClass: "min-w-32" },
  { code: "QUOTECODE", property: "QuoteCode", title: "Code", dataType: "STRING", sortColumn: "quotecode", widthClass: "min-w-40" },
  { code: "STATUS", property: "Status", title: "Status", dataType: "STRING", sortColumn: "status", widthClass: "min-w-36" },
  { code: "COMPANY", property: "CompanyName", title: "Company", dataType: "STRING", sortColumn: "companyname", widthClass: "min-w-48" },
  { code: "CONTACT", property: "ContactName", title: "Contact", dataType: "STRING", sortColumn: "contactname", widthClass: "min-w-40" },
  { code: "WORKFLOW", property: "WorkFlow", title: "Workflow", dataType: "STRING", sortColumn: "workflow", widthClass: "min-w-40" },
  { code: "LOCATIONNAME", property: "LocationName", title: "Location", dataType: "STRING", sortColumn: "locationname", widthClass: "min-w-40" },
  { code: "OWNERNAME", property: "OwnerName", title: "Owner", dataType: "USER", sortColumn: "ownername", widthClass: "min-w-36" },
  { code: "OWNER", property: "OwnerName", title: "Owner", dataType: "USER", sortColumn: "owner", widthClass: "min-w-36" },
  { code: "ASSIGNED", property: "AssigneeName", title: "Assigned", dataType: "USER", sortColumn: "assigned", widthClass: "min-w-36" },
  { code: "STARTDATE", property: "StartDate", title: "Start Date", dataType: "DATE", sortColumn: "startdate", widthClass: "min-w-36" },
  { code: "ENDDATE", property: "EndDate", title: "End Date", dataType: "DATE", sortColumn: "enddate", widthClass: "min-w-36" },
  { code: "PHONE", property: "Phone", title: "Phone", dataType: "STRING", sortColumn: "phone", widthClass: "min-w-36" },
  { code: "EMAIL", property: "Email", title: "Email", dataType: "STRING", sortColumn: "email", widthClass: "min-w-48" },
  { code: "JOBTITLE", property: "JobTitle", title: "Job Title", dataType: "STRING", sortColumn: "jobtitle", widthClass: "min-w-40" },
  { code: "ASSIGNEE", property: "AssigneeName", title: "Assignee", dataType: "USER", sortColumn: "assigneename", widthClass: "min-w-36" },
  { code: "CREATEDBY", property: "CreatedBy", title: "Created By", dataType: "USER", sortColumn: "createdby", widthClass: "min-w-36" },
  { code: "MODIFIEDBY", property: "ModifiedBy", title: "Updated By", dataType: "USER", sortColumn: "modifiedby", widthClass: "min-w-36" },
  { code: "VALUE", property: "Value", title: "Value", dataType: "MONEY", sortColumn: "value", widthClass: "min-w-32" },
  { code: "AMOUNT", property: "Amount", title: "Amount", dataType: "MONEY", sortColumn: "amount", widthClass: "min-w-32" },
  { code: "NETAMOUNT", property: "NetAmount", title: "Net Amount", dataType: "MONEY", sortColumn: "netamount", widthClass: "min-w-32" },
  { code: "TOTALAMOUNT", property: "TotalAmount", title: "Total", dataType: "MONEY", sortColumn: "totalamount", widthClass: "min-w-32" },
  { code: "GRANDTOTAL", property: "GrandTotal", title: "Grand Total", dataType: "MONEY", sortColumn: "grandtotal", widthClass: "min-w-36" },
  { code: "CURRENCYSYMBOL", property: "CurrencySymbol", title: "Currency", dataType: "STRING", sortColumn: "currencysymbol", widthClass: "min-w-24" },
  { code: "CREATEDDATE", property: "CreatedDate", title: "Created Date", dataType: "DATE", sortColumn: "createddate", widthClass: "min-w-40" },
  { code: "MODIFIEDDATE", property: "ModifiedDate", title: "Updated Date", dataType: "DATE", sortColumn: "modifieddate", widthClass: "min-w-40" },
];

export const QUOTE_DEFAULT_COLUMN_CODES = [
  "QUOTETITLE",
  "QUOTECODE",
  "COMPANY",
  "CONTACT",
  "WORKFLOW",
  "LOCATIONNAME",
  "OWNERNAME",
  "STARTDATE",
  "ENDDATE",
  "CREATEDBY",
  "MODIFIEDBY",
  "CREATEDDATE",
  "MODIFIEDDATE",
];
