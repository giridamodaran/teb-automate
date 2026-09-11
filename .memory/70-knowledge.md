# Knowledge

## Login

`POST https://gateway.tebsys.com/gateway/admin/GetLogin`
Body: `{ UserName, Password }`
Success: `Data.JWTToken`, `Data.UserDetail`
Failure: HTTP 500 `{ error, CorrelationId }` or `StatusCode === "401"` with `Messages[0]`

## Refresh

`GET https://gateway.tebsys.com/gateway/admin/RefreshToken` → `Data.Token`

## Logout

`POST https://userv4api.tebsys.com/AcLogout` `{ loginDetail: { Id: UserId } }`

## Forgot password

`POST https://userv4api.tebsys.com/AcUserForgotPassword`
`{ forgetDetail: { Email, IpAddress, Url } }`
Always show generic success.

## Bootstrap after login

- GET MICRO `gateway/menu/GetMenuDetail` → MENU
- GET COMPANY `FnGetFormDetail()` → SCREENDETAIL
- GET USER `FnGetSubscriberUsers()` → SUBSCRIBERUSER (OData `.value`)
- GET COMPANY `FnGetSubscriberSetting()?$expand=Currency` → SETTING
- GET MICRO `gateway/common/UserConfiguration/GetCustomizeMenu` → PINNEDMENU

## Menu shape

`[{ AppCode, AppTitle, Icon, Url, disabled, NavigationMenus: [{ menucode, title, icon, link, disabled, hidden, isdefault, children }] }]`

`GetMenuDetail` is already permission-filtered. Ask uses it to list permitted apps in the chatbot picker (`permittedApps` in `src/lib/nav/menu.ts`). There is no app rail or child nav in this clone.

## Ask lookups and Dynamic AcGetData

Ask owner/location/currency/company/item dropdowns live in `src/lib/api/quote-lookups.ts`. Filter metadata posts through `src/lib/api/dynamic.ts` (`AcGetData`). The Quote composer, mail/template/terms clients, and `docs/quote-apis.md` were removed from this clone.

## Filter APIs (two stacks — do not mix payloads)

Live has **two filter systems**. They share owner / workflow / dates / FilterId conceptually, but the UI, host, and JSON shape differ. A chatbot must pick the stack first, then resolve names to GUIDs.

### 1. Management Dashboard (reporting object)

Widget toolbars on Sales Dashboard (`TEBDashboard`, `/sales/dashboard`). POST MICRO `https://gateway.tebsys.com/gateway/reporting/{Method}` with an unwrapped `FilterDetail` (not `FilterValues[]`). Methods: `GetTeamBasedRecordsCount`, `GetTeamAndMemberBasedRecordsCount` (member drill), `GetTeamBasedQuoteDetails` / `Lead` / `Order` / `OpportunityDetails`, plus invoice / workorder / asset / ticket / workflow-status variants. Toolbar chips: `DATEFILTER`, `OWNERFILTER` (USER `FnGetSubscriberUsersDropdown`). Date `FieldType`: `CREATEDFILTER` → createddate, `UPDATEDFILTER` → modifieddate, `CLOSEDFILTER`, `SCHEDULEFILTER`. Body keys: `WorkflowFilters[{WorkflowId, Stages[]}]`, `DateFilter`, `LocationFilter`, `OwnerAssigneeFilter.{Owners,Assignees}`, `FullTextSearch`, `FilterId`.

### 2. App-specific Manage FILTER (`FilterValues[]`)

FILTER chip bar + `/{app}/managefilter` on every Manage screen (Quote `QUOTEFILTER`, Lead, Opportunity, Order, Item, Invoice, Action, Company, Contact). Metadata: POST MICRO `gateway/admin/GetFilterControls` `{ ModuleCode: <Dynamic module>, ScreenCode: "MANAGE" }` → `Data.Tabs[]` (`TabViewType`, `DbFieldName`). Saved filters: MASTER `AcGetSusbcriberFilterList` / `AcSaveSusbcriberFilter` (`ComponentCode: MANAGE`, Module = Dynamic name e.g. `EstimationManagement`). Apply to grid: DYNAMIC `AcGetData` unwrapped body, `Data.Module` = **short** list code (`TEBQuote` not `EstimationManagement`).

TabViewType → FilterValues: `MULTISELECT` → `ControlType: MULTIVALUE` + `MultiValue[]`; `TREESELECT` → `VALUECONTAIN` + `ValueContainers[{Key, Values}]`; `DATEVIEW` → `DATE` + `DateFilter`.

**FilterId XOR FilterValues:** no filter → both null; saved chip → FilterId only; Apply after edit → `FilterId: null` + full FilterValues (`IsChangeFilter=true` in live). Never send a stale FilterId with modified FilterValues.

### Module codes (easy to mix)

| Entity | Dynamic | List / reporting | Filter screen |
|---|---|---|---|
| Quote | EstimationManagement | TEBQuote | QUOTEFILTER |
| Lead | LeadManagement | TEBLead | LEADFILTER |
| Opportunity | SalesManagement | TEBSale | OPPORTUNITYFILTER |
| Order | OrderManagement | TEBOrder | ORDERFILTER |
| Invoice | InvoiceManagement | TEBInvoice | invoice manage |
| Receipt | InvoiceManagement (invoice collections) | TEBInvoice | nested INVOICERECEIPT |
| Service ticket | TicketManagement | TEBTicket | TICKETFILTER |
| Work order | WorkOrderManagement | TEBWorkorder | WORKORDERFILTER |
| Workforce | WorkForceManagement | tracking APIs (not AcGetData) | `/workforce/route` |
| Action | ActionManagement | TEBAction / GetTeamAndMemberBasedActionDetails | ACTIONFILTER |
| Dashboard | DashboardManagement | TEBDashboard | dashboard screens |

Next.js `ManageGrid` / `listManageRecords` already types `filterId` / `filterValues` but the UI only sends `FullTextSearch`. Grid column views (`AcGetGridColumns`) are not data filters.

## Ask chatbot

Shell **Ask** (`src/components/chat/ChatPanel.tsx`) is a journey, not a blank prompt. Chat answers and errors stay in everyday language (`src/lib/chat/user-copy.ts`) — never show hosts, module codes, or `Source: DYNAMIC TicketManagement MANAGE`.

1. First load: “What do you want to know today?” plus chips for every app in `permittedApps()` (`GetMenuDetail`). Apps Ask cannot query yet (ADM, LOC, …) still appear, with a short not-wired note.
2. App selected: starter questions for that app’s topics (dashboard, quote, lead, …) and a search box. Optional topic chips narrow `pathEntity` (or dashboard stack). Sticky bar shows `Sales · Quotes` and **All apps**.
3. Grounding: last `ReportIntent` plus selected topic; follow-ups like “last 7 days” stay on that module. Named entities in the question still win (`leads I own` switches topic).
4. History: compact thread in `localStorage` key `teb.ask.journey.{UserId}` (charts kept, row dumps dropped). Last ~8 Q&A turns go to `runReportQuestion` → `/api/ask/analyze`. **Clear chat** wipes that device thread. Sign-out keeps it so the same user on this browser can continue. There is no Ask conversation API or database.

Then it parses the question (`src/lib/chat/parse.ts`), resolves GUIDs, then `runReportQuestion` (`src/lib/chat/execute.ts`):

1. MICRO `GetFilterControls` `{ ModuleCode, ScreenCode: MANAGE }` → `Tabs` + `Controls` + `ExtraApi`. Lead uses `LeadManagement` / `MANAGE`.
2. Lookups: that tab’s `ExtraApi` first, then owners / workflows / stages / locations / MASTERBYCODE / company search
3. List: unwrapped DYNAMIC `AcGetData` with `FilterId: null` + combined `FilterValues` (AND tabs, OR values on one tab)
4. Count fallback: MICRO `gateway/reporting/{GetTeamBasedQuoteDetails|Lead|Order|Opportunity|InvoiceDetails}`

Lead phrases: `where owner = X,Y`, `assigned to me`, `status = Open`, `source = Website`, plus dates.

Opportunity (`SalesManagement` / `TEBSale`): same combined tabs, plus **Items**.

Quote (`EstimationManagement` / `TEBQuote`): Manage FILTER via `GetFilterControls` (ScreenCode `MANAGE`, then `QUOTEFILTER`). Spoken fields include owner, assignee, status/workflow, company, contact, location / billing / shipping, type, currency, quote no, valid for, dates, and the same item stack (`ITEM` / `CATEGORY` / `BRAND` / `SKU` / `MODEL`, reporting `Itemfilter`). Catalog: `ProductsManagement` `ITEM` `DROPDOWN`. Phrases: `quotes with item iPhone`, `quotes where owner = me and type = Standard`.

Quote **view** (Ask, read-only): `View quote Q-1024` / `Quote profile for …` / `Open quote …`. Header `GETQUOTEDETAIL` (`Module: EstimationManagement`, `Code: QUOTE`, `Action: GETQUOTEDETAIL`; useful payload is `Value` JSON). Items + price breakdown: same dispatcher `VIEWCONSUMEDITEM` (`ItemDetail`, `TotalSummary`) — not SalesManagement (that 500s). Templates: MICRO `gateway/common/getsubscribertemplatedropdown` unwrapped `{ Module: TEBQuote, LocationId? }` (wrapping `{ data }` returned 0 rows). Notes: MICRO `GetSubscriberNotes` wrapped `{ data: { EntityId, Module: TEBQuote } }` (unwrapped 400s). Actions: `GETQUOTEACTIVITY`. Open in browser: `https://live.teb.cloud/sales/quote/view/{id}` (`NEXT_PUBLIC_TEB_LIVE_APP`). Do not post `CHANGEQUOTESTATUS` from Ask. Do not rebuild the composer.

Order (`OrderManagement` / `TEBOrder`): `GetFilterControls` ScreenCode `MANAGE`, then `ORDERFILTER`. Live managefilter route is `/sales/order/managefilter` (`screen: ORDERFILTER`). Same combined tabs + item stack. Spoken extras: order no, delivery, payment, warehouse. Phrases: `orders with item iPhone`, `order no = SO-1024`.

Invoice (`InvoiceManagement` / `TEBInvoice`): `GetFilterControls` ScreenCode `MANAGE`, then `INVOICEFILTER`. Live managefilter is `/finance/invoice/managefilter`. Same item stack (`Itemfilter`). Spoken extras: invoice no / bill no, due date, payment, tax. Phrases: `invoices with item iPhone`, `invoice no = INV-1024`. Receipts stay the invoice-collections path, not this list.

Action (`ActionManagement` / `TEBAction`): `GetFilterControls` ScreenCode `MANAGE`, then `ACTIONFILTER`. Live managefilter is `/sales/action/managefilter` (`screen: ACTIONFILTER`, manage screen `MANAGEACTION`). Reporting fallback `GetTeamAndMemberBasedActionDetails`. Spoken extras: action type (`MASTER` `ACTIONTYPE`, not quote types), priority, title, related module. Date FieldTypes include `SCHEDULEFILTER` (`scheduledate`) and `DUEFILTER` (`duedate`) — live filter UI lists both on Action. No product `Itemfilter`. Phrases: `actions assigned to me scheduled this week`, `actions where type = Call`, `actions due last 7 days`.

Service ticket (`TicketManagement` / `TEBTicket`): live `GetFilterControls` is **`ModuleCode: TEBTicket`, `ScreenCode: MANAGE`** (not `TicketManagement` — that returns “Filter form not created”). Visible tabs are Workflow + Date; ExtraApi still has Owner, Assignee, Priority (`MasterCode: TICPRI`), Type (`TICT`), Channel (`TICCHA`), Site. Ask synthesizes those ExtraApi fields as filter tabs and formats ExtraApi GET/POST params (FIXED `MasterCode`, GET query `Module=TEBTicket`). Manage list FilterValues go inside wrapped `Data` JSON; `FilterModule` 400s on tickets. Reporting `GetTeamBasedTicketDetails` is valid. Phrases: `service tickets where priority = High`, `ticket no = TKT-1024`, `service tickets created last 7 days`.

Work order (`WorkOrderManagement` / `TEBWorkorder`): live `GetFilterControls` is **`ModuleCode: TEBWorkorder`, `ScreenCode: MANAGE`**. Tabs: Workflow, Site, Date, plus ExtraApi Owner / Assignee / Priority / Type. Same ExtraApi param and wrapped-list FilterValues rules as tickets. Reporting `GetTeamBasedWorkorderDetails`. Phrases: `work orders assigned to me created last 7 days`, `work order no = WO-1024`, `work orders with asset Pump`.

Workforce (`WorkForceManagement`): **not** Manage FILTER / `AcGetData TEBWorkforce`. Live screens: `/workforce/team` and `/workforce/route`. **Find my team** — `GetUserDropdown?Module=TEBWorkforce` (then team-member / tree fallbacks) → POST `GetSignedInUsersLastLocation` with the UserId list → last-known lat/long pins. A named user (`Where is Priya`, `Where is the user now`) — `GetUserLastLocation`. **Route** (`Show route for me`, `Route of {username}`) — POST `GetUserTrackingMapView` with `{ UserId, CurrentDate, DisplayType: STARTDAY, Accuracy: Default, Distance: Default }`, then `MarkerList` + `PolylineList` (`Path`) + start/end. Fallbacks: `GetUserTrackingListView`, `GetUserTrackingTrip`. Maps render as OSM pins + path (`ReportResult.map` / `paths`), never lat/long bar charts.

Company / Contact (`BusinessContactManagement`, list modules `TEBBusiness` / `TEBPeople`): **not** Quote-style `AcGetData` `MANAGE` (that 204s here). Manage list is MICRO `gateway/Contact/GetCustomerDetail` with the paging object as the body (`Data.BusinessType` `COMPANY` | `CONTACT`, `FullTextSearch`, `FilterId`, `FilterValues`, `DateFilter`, `PageNumber`, `PageSize`, `SortColumn: modifieddate`). Search typeahead is MICRO `gateway/contact/getcustomerdetails` `{ BusinessType, SearchKeyWord, IsAll: true }` (already `searchCompanies` / `searchContacts`). Profile is Dynamic `AcGetData` `{ Module: BusinessContactManagement, Code: COMPANY|CONTACT, PrimaryKey, Action: GETCOMPANYDETAIL|GETCONTACTDETAIL }`; useful payload is `Value` JSON. Phone/email live on `PhoneDetail[]` / `EmailDetail[]` (`Title`, `Value`, `IsDefault`) plus scalars; Ask cards use `tel:` / `mailto:` like live Angular. Contact detail includes parent `CompanyId` / `CompanyName` for **view company profile**. `GetFilterControls` for `COMPANYFILTER` / `CONTACTFILTER` often returns “Filter form not created”; Ask still tries it, then synthesizes owner/location/industry/sector/source/relationship/contact type/date/workflow and refines locally. Reporting fallback `GetTeamAndMemberBasedCustomerDetails` must wrap `{ Data: { BusinessType, PageNumber, PageSize } }`. Phrases: `Companies created last 7 days`, `Search companies Acme`, `Company profile for Acme`, `Phone and email for Acme`, `What filters can I use on companies?`.

Management Dashboard (`DashboardManagement` / `TEBDashboard`, `/sales/dashboard`): reporting `FilterDetail` only. Do not send Manage `FilterValues`. Toolbar chips: `DATEFILTER` (FieldType CREATED/UPDATED/CLOSED/SCHEDULE, Mode WITHIN/BETWEEN), `OWNERFILTER` (`FnGetSubscriberUsersDropdown`), assignee, workflow/stages, location sites, Itemfilter `{Items,Categories,Brands,SKUs,Models}`, `FilterId`. Team snapshot: `GetTeamBasedRecordsCount` (member drill `GetTeamAndMemberBasedRecordsCount`). Module snapshots: `GetModuleWiseOverviewDashboard` with ChartCode `LEADSNAPSHOT` / `OPPORTUNITYSNAPSHOT` / `QUOTESNAPSHOT` / `ORDERSNAPSHOT` / `INVOICESNAPSHOT` / `WORKORDERSNAPSHOT` / `ACTIONSNAPSHOT` / `WORKFORCESNAPSHOT` / `TEAMSNAPSHOT` / `MANAGEMENTSNAPSHOT`. Details: `GetTeamBasedQuoteDetails` etc. Ask phrases: `team snapshot this month`, `quote snapshot owned by me`, `what filters can I use on the dashboard?`.

TREESELECT containers are live `{ SingleValue: workflowId, MultiValue: stageIds }` (also sent as Key/Values). Ask treats **stage** and **status** as the same workflow-step filter: `Quotes in Follow Up`, `quotes in stage or status in Follow Up`, `work orders in Assign to Engineer`, `status = Open`. It loads `GetWorkflowStageTree` then per-workflow stage dropdowns, and sends those stage ids on the Workflow tab / reporting `WorkflowFilters`.

Created Filter (`TabCode: DATE`, `FieldType: CREATEDFILTER` by default) modes from live date criteria:

| Mode | UI | Payload |
|---|---|---|
| ANY | Any | `Mode: ANY` |
| WITHIN | With In (incl. today) | `DatePeriod.Period` + `PeriodType` `FILTERDAYS` / `FILTERMONTHS` / `FILTERYEARS`, default last 7 days |
| BETWEEN | Between | `DateRange.FromDate` / `ToDate` |
| FINANCIALPERIOD | Financial Period | `FinancePeriod` |

Also `UPDATEDFILTER` / `NOTUPDATEDFILTER` / `CLOSEDFILTER` / `SCHEDULEFILTER`. `AnyUpdate.PeriodType` is LAST. Ask maps “last N days” to WITHIN, calendar phrases (this month, today) to BETWEEN. Charts + `/api/ask/analyze`.

## Headers (CORS-safe)

Authorization Bearer, Type=WEB, DeviceInfo JSON, DeviceAddress IP, ApiHitDate, Content-Type
