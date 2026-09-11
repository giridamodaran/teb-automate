export type GridDataType = "STRING" | "DATE" | "USER" | "NUMBER" | "MONEY";

export interface GridColumnDef {
  code: string;
  property: string;
  title: string;
  dataType: GridDataType;
  sortColumn?: string;
  widthClass?: string;
  primary?: boolean;
}

export interface GridViewColumn {
  Code: string;
  Sequence: number;
  Title?: string;
  Group?: string;
}

export interface GridCustomView {
  Id: string;
  Title: string;
  IsDefault?: boolean | number;
  Columns: GridViewColumn[];
}

export interface ManageListQuery {
  module: string;
  code?: string;
  action?: string;
  primaryKey?: string;
  pageNumber?: number;
  pageSize?: number;
  sortColumn?: string;
  sortOrder?: boolean;
  fullTextSearch?: string;
  filterId?: string | number | null;
  filterValues?: unknown;
}

export interface ManageListPage<T = Record<string, unknown>> {
  rows: T[];
  total: number;
}

export interface GridViewContext {
  module: string;
  screenCode: string;
}
