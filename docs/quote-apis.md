# Quote APIs (live TEB Cloud)

This document describes how Quote works in production. It is mapped from the live quote microfrontend (`https://prodapps.teb.cloud/quote/remoteEntry.js`, shell version `4.11.8.1`) and the tebsys hosts the Fuse app already calls.

**Rules for this frontend**

- Call these existing APIs. Do not add or change backend endpoints.
- Browser origin for local work is `http://localhost:3000` (CORS already allows it).
- Send only CORS-safe headers: `Authorization: Bearer {JWT}`, `Type: WEB`, `Content-Type: application/json`, `DeviceInfo`, `DeviceAddress`, `ApiHitDate`. Do not send Latitude/Longitude.

Typed helpers live in `src/lib/api/quote.ts`.

---

## 1. Where Quote sits

| Item | Live value |
| --- | --- |
| Product module | Quote (internally **Estimation**) |
| Dynamic module name | `EstimationManagement` |
| List / reporting code | `TEBQuote` |
| App | Sales (`SALES`) |
| Remote | `https://prodapps.teb.cloud/quote/` |
| Primary dispatcher | `POST https://dynamicv4api.tebsys.com/AcGetData` |

Quote is not a dedicated REST resource (`/quotes/:id`). Almost every read/write goes through **Dynamic `AcGetData`** (and sometimes **`AcAddDetail`**) with an **Action** string that tells the backend what to do.

### Live UI routes

| Screen | Path |
| --- | --- |
| Manage | `/sales/quote/manage`, `/sales/quote/managefilter`, `/sales/quote/list-view` |
| Add | `/sales/quote/addquote` |
| View | `/sales/quote/view/:id` |
| Diary | `/sales/quote/diary` |
| Pipeline / funnel | `/sales/quote/pipeline`, `quote-stage-pipeline`, `quote-week-pipeline`, `quote-day-pipeline`, `funnel` |
| Template | `/sales/quote/template` |

---

## 2. Hosts

| Key | Base URL | Used for |
| --- | --- | --- |
| DYNAMIC | `https://dynamicv4api.tebsys.com` | `AcGetData`, `AcAddDetail` (Quote CRUD, items, view panels) |
| MICRO | `https://gateway.tebsys.com` | Autocomplete, reporting, filters, documents, users |
| COMPANY | `https://companyv4api.tebsys.com` | `FnGetQuoteModuleSetting`, location dropdown, form metadata |
| MASTER | `https://mastersv4api.tebsys.com` | Type dropdown, saved filters, brand dropdown |
| USER | `https://userv4api.tebsys.com` | Current user / team (shared with other modules) |
| TEMPLATE | `https://templatev4api.tebsys.com` | Quote templates |
| WEBCONNECT | `https://webconnectorv4api.tebsys.com/api` | Occasional connector calls |

Configured in `src/lib/api/hosts.ts`.

---

## 3. How the dispatcher works

There are **two POST shapes** to the same Dynamic URL. Mixing them up is the usual cause of empty or 500 responses.

### 3.1 Wrapped `{ data: ... }` — Add, View, edit, items

Used by live `dynamicApiPost`:

```http
POST https://dynamicv4api.tebsys.com/AcGetData
```

```json
{
  "data": {
    "Module": "EstimationManagement",
    "Code": "QUOTE",
    "PrimaryKey": "<quoteId or empty>",
    "Data": "<string, often JSON>",
    "Action": "<ACTION_CODE>"
  }
}
```

| Field | Meaning |
| --- | --- |
| `Module` | `EstimationManagement` for quote header/view. Items use `SalesManagement`. Company/contact lookups use `BusinessContactManagement`. |
| `Code` | Screen code: `QUOTE` (add/view header), `MANAGE`, `ITEMQUOTE`, `ADDITEM`, `COMPANY`, `CONTACT`, … |
| `PrimaryKey` | Quote Id (empty string on first add). |
| `Data` | **String.** Either `""`, a JSON string of the form, or a small JSON command such as `{"ID":"FORMTYPE","Value":""}`. |
| `Action` | What the backend should do (`GETQUOTEDETAIL`, `ADD`, `COPYQUOTE`, …). |

**Response quirks (match the live app):**

- View / edit load: **`Value`** (capital V) is a **JSON string**. Parse it.
- Save header: **`value`** (lowercase) is the new or existing quote Id.
- Envelope may also include `Succeeded`, `Messages`, `Data`, `StatusCode`.

`AcAddDetail` uses the same `{ data: payload }` wrap:

```http
POST https://dynamicv4api.tebsys.com/AcAddDetail
```

### 3.2 Unwrapped paging body — Manage grid

Live manage uses `microApiPost` against whatever `ApiPost` the screen metadata has. For Manage Quote that is still Dynamic `AcGetData`, but the body is **not** wrapped in `{ data }`:

```http
POST https://dynamicv4api.tebsys.com/AcGetData
```

```json
{
  "Data": {
    "Module": "TEBQuote",
    "FilterId": null,
    "FilterValues": null,
    "FullTextSearch": ""
  },
  "PageNumber": 0,
  "PageSize": 25,
  "SortColumn": "modifieddate",
  "SortOrder": true
}
```

Response (after the live `BindingData` helper, non-webform modules):

```json
{
  "Data": [ { "Id": "...", "QuoteTitle": "...", "...": "..." } ],
  "TotalCount": 123
}
```

`PageNumber` is 0-based. Default sort column is `modifieddate`, `SortOrder: true`.

---

## 4. Screen codes (bundled form metadata)

The quote remote ships screen JSON (same shape as `FnGetFormDetail` / `SCREENDETAIL`). Important screens:

| ScreenCode | Title | Role |
| --- | --- | --- |
| `QUOTE` | Add Quote | Header form; also used as view’s Dynamic `Code` |
| `MANAGE` | Manage Quote | Grid + card list |
| `ITEMQUOTE` | Quote Item | Line items |
| `QUOTEFILTER` | QUOTE Filter | Saved / advanced filters |
| `QUOTESTATUS` | Quote Status | Status change UI |
| `NOTES` / `NOTE` | Notes | Notes on a quote |
| `ACTION` | Manage Action | Follow-up actions |
| `QUOTETEMPLATE` | Add TEMPLATE | Templates |
| `VIEWQUOTEINFO` | (view toolbar) | Edit / Delete / Back / Next |

Primary key on these screens is `Id`.

---

## 5. Manage Quote

### 5.1 List

- **URL:** `POST DYNAMIC/AcGetData` with `{ data: { Module: "EstimationManagement", Code: "MANAGE", PrimaryKey: "Id", Action: "MANAGE", Data: JSON.stringify({ PageNumber, PageSize, OrderBy, SortOrder, Search }) } }`
- Parse **`Value`** JSON `{ QuoteDetail, TotalRecord }`.
- The unwrapped `Module: TEBQuote` paging body is used by some shared table helpers; Quote Manage’s working loader is the wrapped **`MANAGE`** action.

**Columns / row fields the live grid binds:**

`Id`, `QuoteTitle`, `QuoteCode`, `CompanyName`, `ContactName`, `JobTitle`, `Phone`, `Email`, `WorkFlow`, `LocationName`, `OwnerName`, `CreatedBy`, `ModifiedBy`, `CreatedDate`, `ModifiedDate`, `StartDate`, `EndDate`, `Status`, `ParentValue`, plus schedule (`QUOTEACTIVITY`) and consent flags for notes/actions.

Row click opens `/sales/quote/view/{Id}`.

### 5.1.1 Grid View (per-user columns)

Column visibility and order are **per user**, stored on COMPANY:

| Call | Body wrap | Payload |
| --- | --- | --- |
| `AcGetGridColumns` | `{ screendetail }` | `{ Module: "EstimationManagement", ScreenCode: "MANAGE" }` |
| `AcAddGridColumns` | `{ columns }` | `{ Code, Module, ScreenCode, Sequence, CustomViewId }` |
| `AcRemoveGridColumns` | `{ columns }` | same as add |
| `AcAddCustomView` | `{ customview }` | `{ Title, Module, ScreenCode, CustomFields: [{ Code, Sequence }] }` |
| `AcUpdateCustomViewTitle` | `{ customview }` | `{ Id, Title, Module, ScreenCode }` |

The shared UI is `ManageGrid` (`src/components/grid/ManageGrid.tsx`). Toolbar **Grid view → Customize columns** opens the Set View panel (enable/disable + reorder). Default sort `modifieddate` desc; search debounces 300ms; page sizes 10/20/25/50/100.

### 5.2 Team reporting (insights / some shared widgets)

```http
POST https://gateway.tebsys.com/gateway/reporting/GetTeamBasedQuoteDetails
```

Same family as Lead/Order reporting (`GetTeamBasedLeadDetails`, `GetTeamBasedOrderDetails`). Used when a widget is keyed as `TEBQuote`, not as the main manage grid.

### 5.3 Autocomplete (search quotes elsewhere)

```http
GET https://gateway.tebsys.com/gateway/quote/quoteautocomplete?Keyword={text}&IsAll={true|false}
```

### 5.4 Saved filters

| Call | Host | Method |
| --- | --- | --- |
| Filter control metadata | MICRO | `POST gateway/admin/GetFilterControls` (`ModuleCode` = quote module) |
| List saved filters | MASTER | `AcGetSusbcriberFilterList` |
| Save filter | MASTER | `AcSaveSusbcriberFilter` (`{ data: ... }`) |

### 5.5 Toolbar actions on a row

Live action codes include `EDITQUT` (open add/edit), `DELQUT` (delete confirm), `CHANGESTATUS`, `REVISE`, `SENDMAIL`, `COPYQUOTE`, notes, actions, storyboard.

Delete is two-step: **`CHECKDELETEPERMISSION`** then the delete action (`DELQUT` / `DELETE`).

---

## 6. Add Quote

Add is a **wizard**. Header is saved first; the returned Id is then used for items and later steps (`TabIndex` is sent on save).

### 6.1 Load (edit / copy)

```json
{
  "data": {
    "Module": "EstimationManagement",
    "Code": "QUOTE",
    "PrimaryKey": "<quoteId>",
    "Data": "{\"ID\":\"FORMTYPE\",\"Value\":\"\"}",
    "Action": "QUOTEDETAILEDIT"
  }
}
```

Parse **`Value`**. Fields include `CompanyId`, `ContactId`, `AppType` (company vs contact), `CustomField`, etc.

If copy: live sets `isCopyQuote` and later saves with Action `COPYQUOTE` plus `IsCopyDocuments`.

### 6.2 Save header

```http
POST https://dynamicv4api.tebsys.com/AcAddDetail
```

```json
{
  "data": {
    "Module": "EstimationManagement",
    "Code": "QUOTE",
    "PrimaryKey": "<id or empty>",
    "Data": "<stringified form JSON>",
    "Action": "ADD"
  }
}
```

For copy, `Action` is `COPYQUOTE` instead of `ADD`.

Form JSON the live Details tab posts:

| ControlName | UI label | Control | Required |
| --- | --- | --- | --- |
| `CompanyId` | Company | Autocomplete | no |
| `ContactId` | Contact | Autocomplete | no |
| `QuoteTitle` | Title | Text | **yes** |
| `QuoteTypeId` | Type | Dropdown | **yes** |
| `LocationId` | Location | Dropdown | **yes** |
| `WorkFlowId` | Workflow | Dropdown | — |
| `CurrencyId` | Currency | Dropdown | — |
| `SubmittedDate` | Submit Date | Date (UTC string) | — |
| `Validfor` | Valid For (days) | Text | — |
| `Reference` | Reference | Text | — |
| `Description` | Description | Text | — |

Also sent when present: `Id`, `CustomField[]`, `TabIndex`, `IsCopyDocuments`.

Success: **`value`** = quote Id. This app then **`router.replace`s to `/sales/quote/view/{id}`** so the URL is refreshable and shareable. Add and View are the same composer; View (and Add after save) show a **Quotes** back link to `/sales/quote/manage`. Live then stores the form and moves to the next step (items).

Screen metadata `ApiPost` is **`AcAddDetail`** (`Api: DYNAMIC`, `ParamName: data`). Runtime `dynamicApiPost` posts to that Method with Action `ADD`. Do not save the header through `AcGetData` — that can return an Id without persisting field values (title stored blank).

### 6.3 Header lookups

| Field | Host | Call |
| --- | --- | --- |
| Company | MICRO | `POST gateway/contact/getcustomerdetails` `{ BusinessType: "COMPANY", SearchKeyWord, IsAll }` |
| Contact | MICRO | Same with `BusinessType: "CONTACT"`. After a company is selected, also send `CompanyId`. Fallback: DYNAMIC DROPDOWN `BusinessContactManagement` / `COMPANY` or `CONTACT`. |
| Type | MASTER | `FnGetDropdown` with `dropdownCode=MASTERBYCODE`, `startWith=OPPTYPE` |
| Location (site) | COMPANY | `FnGetLocationDropdown` (also MICRO `gateway/DropDown/GetLocationDropDown`) |
| Workflow | COMPANY | `FnGetWorkFlowDropdown?locationId=&module=TEBQuote` (depends on site) |
| Workflow steps | MASTER | `AcGetWorkFlowStepsByWorkflow` |
| Currency | MASTER / COMPANY | `FnGetDropdown?dropdownCode=CURRENCY`, `FnGetSubscriberUserCurrency` |
| Owner / assignee | COMPANY | `FnGetCurrentUserTeamMembers?moduleName=SalesManagement` (also MICRO `gateway/admin/GetUserDropdown`) |

`SearchKeyWord` may be empty (focus preload). `IsAll` is true when quote module setting `AllCompany` is `Active`.

Do not post an object as Dynamic `Data` for this search — that shape 500s. Dynamic fallback `Data` is `JSON.stringify(keyword)` (a string).

On company **CHANGE**, live:

1. Auto-fills **Title** from the selected company name (`getTitleFromModule`; B2C uses contact name). Do not overwrite a title the user already edited.
2. Reloads contacts for that company and auto-selects the first.
3. Quote **Type** defaults from master `OPPTYPE` (`IsDefault`, else first row).

**Do not** take Workflow, Owner, Site, or Currency from the company/contact row. Those four are the Add Quote **settings gear** values and stay loaded whether or not a company/contact is selected.

The main-form **Location** control is the same **Site** (`LocationId`) as the settings panel.

On contact **CHANGE**, live binds billing/shipping sites for that contact (`BILLINGTO` / `SHIPPINGTO`). Those stay off the one-page Add canvas.

### 6.4 Defaults on a blank Add (settings gear: workflow, owner, site, currency)

Live Add Quote has a **settings** icon (`teb-quote-setting`). On open it pre-loads, **independent of company/contact**:

| Settings field | Form field | Source |
| --- | --- | --- |
| Currency | `CurrencyId` | `USER/FnGetSubscriberUserCurrency` (`UserCurrencyId` → `UserLocationCurrencyId` → `SubscriberCurrencyId`), else `QUOTEDEFAULT`, else subscriber `SETTING` (`$expand=Currency`), else master `CURRENCY` `IsDefault` / first row |
| Site | `LocationId` | `COMPANY/FnGetLocationDropdown()` (`IsDefaultLocation` / first), patched by `QUOTEDEFAULT` `LocationId` or `SETTING.LocationId` |
| Workflow | `WorkFlowId` | `COMPANY/FnGetWorkFlowDropdown()?locationId={site}&module=TEBQuote` (`IsDefault` / first). Reloads when Site changes |
| Owner | `OwnerId` | **Currently logged-in user** (`CURRENTUSER` / `UserId`). Team list from `SUBSCRIBERUSER` (`FnGetSubscriberUsers()`) |

Live `QUOTEDEFAULT` still runs and can patch Site / Workflow / Currency onto those dropdowns. Owner is not a Details-tab control; send `OwnerId` on save as the logged-in user.

After site is set, `FnGetWorkFlowDropdown?locationId={site}&module=TEBQuote`. If `WorkFlowId` from defaults is in that list, select it; otherwise select the default/first workflow.

This Next.js Add page preloads the same four values on open (settings gear + Site on the form) so process is not blocked waiting for the user to pick them.

### 6.5 Create quote from another module (automation)

When a quote is created from Lead / Opportunity / Work Order, live sets:

| Source | Action |
| --- | --- |
| Lead | `SAVEQUOTEAUTOMATIONLEAD` |
| Opportunity | `SAVEQUOTEAUTOMATIONOPPORTUNITY` |
| Work Order | `SAVEQUOTEAUTOMATIONWORKORDER` |

`ModuleCode` and `Code` stay Quote (`QUOTE` / `TEBQuote` depending on the helper).

---

## 7. Quote items (Add step 2)

Items are **not a View tab**. Live Add is a wizard: save header → then `ITEMQUOTE`. The one-page composer must ingest this grid on the same page as Details.

### 7.1 Screen and grid

Screen `ITEMQUOTE`. Grid load (`GridDetail.ApiCall` / `ApiPostCall`):

| Action | Use |
| --- | --- |
| `VIEWITEM` | Line list |
| `VIEWCONSUMEDITEM` | Filled lines (rows with an `ItemName`; blank rows are ignored) |

Response **`Value`** JSON: `{ ItemDetail, Group, TotalSummary }`.

Grid columns: Item (SKU / ItemCode), Unit Price, Quantity, Discount, Tax, Net Amount. Row actions include note / remove.

Once a catalog item is selected, the Item cell is a **label** (name plus secondary SKU / ItemCode, and Model / Specification when VIEWITEM has them). Live ITEMQUOTE ExtraDisplay is `["SKU","ItemCode"]`. Do not keep a combobox with × on a filled line — that × only clears the search text and is easy to mistake for removing the line. Empty lines keep the typeahead. Removing a line is the row close action (`REMOVEITEM`).

### 7.2 Add a line

Catalog search (this is the product master lookup — not a View “remote items” tab):

- Item Name: `ProductsManagement` / `ITEM` / `DROPDOWN`
- Optional Brand (`MASTER` `startWith=BRD`) and Category (`GETCATEGORYDROPDOWN`)

Line fields: `ItemId`, `ItemName`, `PricePerUnit` (posted; UI label is Unit Price), `PriceSchemeId`, `Quantity`, `UnitId`, `OverrideQuantity`, plus discount/tax.

### 7.2.1 Select item (ingest defaults)

Catalog search is `ProductsManagement` / `ITEM` / `DROPDOWN` with `Data` = the typed keyword.

On change, live `CHANGEVAL` calls `GridDetail.ApiCall` which is **`VIEWITEM`** (`SalesManagement`, `PrimaryKey: ""`, `Data: JSON.stringify({ Search: "", ItemId: [id] })`) and takes row `[0]`. That row is the default ingest (`PricePerUnit` → Unit Price). The inline grid variant also sends `EntityId: quoteId`. Catalog `DROPDOWN` by `ItemId` is only a fallback for schemes/units if VIEWITEM has no price:

- `PricePerUnit` / `UnitPrice`, `Quantity`, `DiscountAmount`
- `MinQuantity`, `MaxQuantity`, `Multiples`, `OverrideQuantity`
- `ItemPriceScheme[]` (`Id`, `PricingTitle`) → price scheme dropdown
- `UnitDetail[]` (`Key` / `Value`) → mapped item units. Live rows often use `Key` = unit id and `Value` = display name (`Nos`, `KG`); the parser treats whichever side looks like an id as `Id`. Also bind `ItemUnit` / `UnitName` / `UnitId` when the list is missing. Catalog `DROPDOWN` is fetched when VIEWITEM has a price but no `UnitDetail`. The unit shows as a label under Qty (same pattern as pricing type). It is editable only when pricing type is **MANUAL** and more than one mapped unit exists.
- `PriceType` / `PricingType` — unit price is editable only when type is **MANUAL** (user/custom). `STANDARD`, `FIXED`, `LOOKUPPRICE`, `VOLUME`, `SPECIFICATION` stay read-only. A small pricing-type icon next to unit price opens available methods (`PricingMethodDetail` / schemes) including Manual when the type is locked.
- `TaxDetail` — if present, select that tax on ingest (no second click)
- Line discount/tax persist on `ADDMULTIPLEITEM` / `ADDITEM` (`Discount`, `DiscountValueType`, `DiscountType`, `TaxId`). Extra tax after the line exists is `ADDITEMTAX`.

The composer saves **one row at a time** once the quote header Id exists:

- Select a catalog item → ingest `VIEWITEM` defaults, then `AcAddDetail` **`ADDITEM`** immediately (`Module: EstimationManagement`, `Data` = the item object, `PrimaryKey` = quote Id). Insert omits `Id`. Live order grids may use `SalesManagement`; quote lines 500 there (`Opportunity not found`). Reload via `VIEWCONSUMEDITEM` on `EstimationManagement`.
- Quantity / unit price / inline discount: debounce **500ms**, flush on blur.
- Tax, unit, scheme, pricing type, and catalog discount: save on change.

Header **Save** still posts any remaining unsaved lines the same way (one `ADDITEM` each). Empty / incomplete rows are not posted. Do not persist during view hydration.

### 7.2.2 Quantity

Default qty comes from the item. Clamp (do not only error):

- Not zero — use min or 1
- Not below `MinQuantity`
- Not above `MaxQuantity` when max &gt; 0
- Snap to `Multiples` when multiples ≠ 1

Live can skip the clamp with permission `OverrideQuantity` (Yes/No). This app auto-updates the qty and shows a short hint.

### 7.2.3 Discount

Line control is TWOCTRL: amount + type.

- Inline: `DiscountType` `INLINEDISCOUNT` and `DiscountValueType` `PERCENTAGE` (default) or `VALUE`
- Other types (Voucher, Range, …) from MASTER `FnGetDropdown` `dropdownCode=DISCOUNTVARIANT`. Catalog values: MICRO `gateway/order/GetDiscountDetailDropDown` (`DiscountType`, `DiscountableOn: TOTDISC` or `ITEMDISC`, `EntityId: quoteId`). Also `DISCOUNTAPPLICABLE`.

Line discount amount: `%` = `qty × price × value / 100`; value = entered amount.

Live validation (clamp + hint on blur, same pattern as qty):

- Unit price `0` → discount forced to `0` (“You cannot apply a discount when the unit price is 0.”). Tax is also `0`.
- `%` cannot be `< 0` or `> 100`. If the catalog row has `InlineDiscount` between 1 and 99, that is the max %.
- Amount cannot exceed the line subtotal (or the `InlineDiscount` cap of that subtotal).

### 7.2.4 Tax

Master list is Dynamic `TAXDROPDOWN` (`Module: EstimationManagement` first; SalesManagement often returns `[]`). Rate can be `%` or value; line tax = rate × qty (percentage is on unit price, then × qty — live `calculateTax`). **If unit price is 0, tax is 0**. A line can have **multiple taxes** (e.g. CGST + SGST). Live stores them on `Taxes[]` and applies extras with `ADDITEMTAX` (`EntityId`, `EntityItemId`, `TaxId: [id]`). Remove one with `REMOVEITEMTAX` (`OpportunityId`, `OpportunityItemId`, `TaxId` — quote uses those Opportunity* field names).

Persist **after** the header Id exists:

```http
POST https://dynamicv4api.tebsys.com/AcAddDetail
```

| Action | Body `Data` |
| --- | --- |
| `ADDITEM` | Quote composer: Module **`EstimationManagement`**, Code/Action `ADDITEM`, `PrimaryKey` = quote Id, `Data` = one item (`ItemId`, `PricePerUnit`, `Quantity`, `UnitId`, `OverrideQuantity`, discount/tax/price type). Omit empty GUIDs and catalog-dropdown extras. `SalesManagement` is the order-grid fallback and 500s on quotes. |
| `ADDMULTIPLEITEM` | Wizard save-all (`saveItems`). `Code` is screen `ITEMQUOTE`. `Data`: `{ EntityId: quoteId, ItemDetail: [ … ] }`. Not the inline grid path. |

Each `ItemDetail` row posts at least: `SequenceNo`, `ItemId`, **`PricePerUnit` (not `UnitPrice`)**, `PriceSchemeId`, `Quantity`, `UnitId`, `OverrideQuantity`, plus `Discount`, `DiscountValueType`, `DiscountType`, `DiscountId`, `Tax`, `TaxId`.

Live will not save if the grid is empty (“Please select the items…”).

Reload after save: `VIEWCONSUMEDITEM` (live `getItems` / `ApiPostCall`) or `VIEWITEM` (`ApiCall`). Parse `Value` JSON `{ ItemDetail, Group, TotalSummary }`.

### 7.3 Remove a line

`GridDetail.RemoveApiCall`: `AcAddDetail` Module `SalesManagement`, Code/Action **`REMOVEITEM`**, `PrimaryKey` = quote Id.

`Data`: `{ EntityId: quoteId, ItemEntityId: line.Id }`.

Related removes: `REMOVEITEMTAX` (`{ OpportunityId, OpportunityItemId, TaxId }` on quotes; `{ QuoteId, QuoteItemId, TaxId }` fallback), `REMOVEITEMGROUP` (`Data` = GroupId).

### 7.4 Later (not one-page v1)

Item groups / reorder (`ADDITEMGROUP`, `CHANGESEQUENCEITEMGROUP`), optional/add-on items, consumed/inventory (`SAVECONSUMEDITEM`, `CONSUMEDITEMEDIT`), spec / volume / lookup pricing, item charges, bulk import.

Brand: `MASTER FnGetDropdown` with `startWith=BRD`.

Pricing/totals also reuse **order** gateway helpers:

- `gateway/order/GetDiscountDetailDropDown`
- `gateway/order/RoundOffTotalAmount`
- `gateway/order/ValidateOrderEntity`

---

## 8. View Quote

View is a **post-save workspace**. Do not fold these tabs into the one-page Add canvas except as noted in §14.

Load: `GETQUOTEDETAIL`. Toolbar (`VIEWQUOTEINFO`): **VIEWTOOLBAR** (`Module: EstimationManagement`, `Code: VIEWQUOTEINFO` or `QUOTE`, `PrimaryKey` = quote id, `FilterModule: TEBQuote`) returns the actions this user may run in this stage. Live ActionType / Code values: Edit (`EDITQUT`), Delete (`DELQUT`), Revise (`REV`), Archive (`ARC`), Copy (`COPYQUOT`), Change status (`CHANGEQUOTESTATUS`), Send mail, Schedule. Header flags `EditPermission` / `DeletePermission` and the current `WorkFlowDetail` step (`IsEdit` / `IsDelete`) are fallbacks when the toolbar list is empty.

This composer: full-height left notch (`chevron_left` → manage) and right notch (`more_vert`) for permitted overflow actions. Status stays in the header body. The first header create still uses empty-state **Save quote**. Overflow **Edit** reopens the header form; **Save** posts `ADD` with Id and closes it. Company cannot be changed after create. Contact stays editable only when module setting `ChangeContact` is `Active`. Delete is two-step: MICRO `gateway/order/ValidateOrderEntity` `{ EntityIds, Type: EstimationManagement }` (or `CHECKDELETEPERMISSION`) then Dynamic `DELETE` with `PrimaryKey: { key: [id], ModuleName: false }`. Archive uses Action `ARC` / `ARCHIVE`. Revise uses Action `REV`, falling back to `COPYQUOTE`. Do not invent actions the toolbar/stage did not allow.

### 8.1 Header

```json
{
  "data": {
    "Module": "EstimationManagement",
    "Code": "QUOTE",
    "PrimaryKey": "<quoteId>",
    "Data": "",
    "Action": "GETQUOTEDETAIL"
  }
}
```

Parse **`Value`**. Observed fields: `Id`, `QuoteTitle`, `QuoteCode`, `CompanyId`, `CompanyName`, `ContactId`, `ContactName`, `LocationId`, `WorkFlowId`, `WorkFlowDetail`, `CurrencySymbol`, `CurrencyIcon`, `EntityId`, `OpportunityId`, `Consent`, `Notes` / `Note`, `Mails`, `Action` / `TotalAction`, `CustomField`, `AppType`.

### 8.2 Top-level tabs (`ViewContainer`)

| Index | Code | Title | Action / API |
| --- | --- | --- | --- |
| 1 | `HIGHLIGHTS` | Highlights | Snapshot; pricing via `GETPRICINGSCHEME` |
| 2 | `STORYBOARD` | Story Board | `GETSTORYBOARD` |
| 3 | `CONTACTDETAIL` | Contact Detail | `GETCOMPANYCONTACTLIST` |
| 4 | `LOCATIONDETAIL` | Location Detail | `GETCUSTOMERLOCATIONLIST` |
| 5 | `FINANCEDETAIL` | Finance Detail | `GETCUSTOMERFINANCELIST` |
| 6 | `DOCUMENT` | Document | MICRO `gateway/document/…` |

### 8.3 Highlights inner panels (`ChildComponent`)

| Code | Title | Fields / notes |
| --- | --- | --- |
| `BASICINFORMATION` | Basic | Added On, Updated On, Updated By, Workflow, Location |
| `INSIGHTS` | Insights | Last Contacted |
| `INFO` | Info | Quote No., Currency, Reference, Valid For, Revisions, Mails, Submitted By, Expected By |
| `SALES` | Sales | Opportunity / Order counts; `GETPRICINGSCHEME` |
| `CONTACT` | Contact | Company, Contact, Billing Site, Shipping Site, Actions, Notes |
| `ACCESS` | Access | Owner, Assignee |
| `ACTIVITY` | Activity | `GETQUOTEACTIVITY` |
| `CUSTOMFIELDS` | Custom Fields | MICRO custom-field dropdowns |
| `MAILS` | Mails | Mail list |
| `REVISION` | Revision | Revision history |

Activity also uses `QUOTEACTIVITY` / `LEADSNOTES` / `GETMODULELASTNOTESREC`. Diary: `QUOTEDIARYBYID`.

Live View-tab **Manage Notes** (`NOTES` / `NOTESMANAGE`) is a separate screen. This app’s quote composer uses the **shared Notes widget** (same as Lead/Order), not `LEADSNOTES`. See §8.6.

### 8.6 Shared notes (composer tools panel)

Notes are a reusable entity tool. Quote **lists** with `Module: EstimationManagement` and `EntityId` = quote id (same as the live widget). Quote **saves** with `Module: TEBQuote` (live stored `Module` / `ModuleCode`) so the old View notes list (`ModuleCodes` from `getnotesapps`) can see them. Implemented in `src/lib/api/notes.ts` and `src/components/tools/`.

| Call | Host | Path / action | Body |
| --- | --- | --- | --- |
| Related apps | MICRO GET | `gateway/admin/getnotesapps?Module={module}` | Returns `{ Id: "TEBQuote", Text, … }`. Live’s manage-notes filter uses these codes; posting them as `ModuleCodes` on the list call returns no rows. Composer list omits `ModuleCodes`. |
| List | MICRO POST | `gateway/common/GetSubscriberNotes` | Unwrapped `{ Data: { EntityId, Module }, PageNumber, PageSize }` |
| Add / edit | DYNAMIC `AcAddDetail` | `Module: Notes`, `Code: MANAGE`, `Action: ADD` | `Data` JSON: `{ ModuleId, Module: "TEBQuote", Type: "Private" \| "", Description, NoteType: "RTB", NotesId, IsPin }`. Live stored rows use `Module`/`ModuleCode` `TEBQuote`, not `EstimationManagement`. Widget `Code` is `MANAGE` (not View-tab `NOTESMANAGE`). Success is OData `{ value: "<noteId>" }`. |
| Delete | DYNAMIC `AcAddDetail` | `Action: DELETE` | `PrimaryKey` = note `Id`, `Data: ""` |
| Pin toggle | DYNAMIC `AcAddDetail` | `Action: PINNOTE` | `PrimaryKey` = note `Id`, `Data: ""` |

If `getnotesapps` fails, list with `ModuleCodes: []`. List rows bind `Id`, `Description` / `Notes`, `IsPin`, `Type`, `NoteType`, `CreatedByName`, `CreatedOn`. Do **not** use Quote `LEADSNOTES` for this panel.

Other view actions: `UPDATE` (in-place), `CHANGEQUOTESTATUS`, `QUOTEVALIDATEFIELDS`, `GETLEADVIEW`. Feedback: MICRO `gateway/admin/GetFeedbackPermissions` with `ModuleId: TEBQuote`.

### 8.4 Documents, PDF, mail

Live screen `QUOTEMAIL` (“Send Email”). Overflow **Send email** loads defaults then posts the form.

| Call | Host | Path / action | Body |
| --- | --- | --- | --- |
| Mail defaults | DYNAMIC `AcGetData` | `Module: EstimationManagement`, `Code: QUOTEMAIL`, `Action: GETMAILDETAIL`, `PrimaryKey` = quote id | `Value` is JSON `[[{ Control, Value }]]` (`ToMail`, `Template`, `Subject`, `Message`, …). Values are often extra-quoted JSON strings. |
| From addresses | MICRO POST | `gateway/common/GetVerifiedFromEmails` | `{ Modules: "TEBQuote", LocationId }` |
| Template list | MICRO POST | `gateway/common/getsubscribertemplatedropdown` | `{ Module: "TEBQuote", LocationId }` |
| Send | MICRO POST | `gateway/quote/SendMailToCustomers` (`QUOTEMAIL` ExtraApiCall `SendMail`) | Form value plus `EntityId`, `Template`, `Attachments` (document ids). |
| Preview PDF | TEMPLATE `AcDownloadPdf` | `Action: SAVETEMPLATE` | Outer `{ Module: TEMPLATE, Code: TEBQuote, PrimaryKey: quoteId }`. `Data` JSON `{ EntityId, Module: TEBQuote, TemplateId }`. Live `a2.EstimationManagement` is `TEBQuote`. `Value` is the PDF URL (or nested `Url` / `FileUrl`). Do not fall through to `Data.Module: EstimationManagement` after a successful empty `TEBQuote` response — that 500s with the admin message. |
| Download PDF | TEMPLATE `AcDownloadPdf` | `Action: DOWNLOADTEMPLATE` | Same payload. |
| Quote template screen | DYNAMIC | `TEMPLATE` / `TEBQuote` / `VIEWTEMPLATE` | Template builder list; composer preview uses `SAVETEMPLATE` instead. |

Form fields: `FromId`, `ToMail`, `CcMail`, `BccMail`, `Template`, `Subject`, `Message` (live WYS; this app uses a textarea). Attachments in live are quote documents; v1 sends `Attachments: []`.

Overflow **View template** picks the default template from `GETMAILDETAIL` / the dropdown and opens `SAVETEMPLATE` in a dialog.

### 8.7 Terms & conditions (delivery terms)

Live quote has no `DeliveryTerm` header field. Quote **Terms & Conditions** is screen `QUOTETERMSANDCONDITION`. Item delivery schedules (`DELIVERY` / `gateway/order/getorderdeliveries`) are on **Order**, not Quote. Quote `ITEMQUOTEDELIVERY` is an item-grid variant, not delivery terms.

| Call | Host | Path | Body |
| --- | --- | --- | --- |
| List | MICRO POST | `gateway/term/getentitytermdetailbymoduleid` | `{ Module: EstimationManagement, ModuleId: quoteId }` → `{ Data: [{ Id, TermSetName, MasterTermSetId, EntityTermDetail: [{ Id, TermTitle, TermTypeId, TermText }] }] }` |
| Term types | MICRO POST | `gateway/common/GetSubscriberMasterContentDropDown` | `{ MasterCode: "TERMTYPE", startWith: "" }` |
| Add / edit | MICRO POST | `gateway/term/saveentitytermdetail` (`ADDTERMS` ApiPost) | `{ Id, MasterTermSetId, Module: EstimationManagement, EntityId, EntityTermDetail: [{ Id, TermTitle, TermTypeId, TermText }] }` |
| Delete term | MICRO DELETE | `gateway/term/deleteentityterm` | `{ Id: termSetId, TermId }` |
| Delete set | MICRO DELETE | `gateway/term/deleteentitytermset` | `{ Module, ModuleId, TermSetId }` |
| Add from catalog | MICRO POST | `gateway/term/saveentitytermdetail` (`ADDEXISTTERM`) | `{ Id, Module, EntityId, MasterTermSetId, EntityTermDetail: [{ MasterTermId }] }` |
| Reorder | MICRO POST | `gateway/term/changesequenceofentityterms` | `{ Id, TermId, EntityId, Module, Sequence }` |

Composer dock **Terms** lists and adds terms. Catalog term-set pick and reorder are not in this slice.

### 8.5 Custom fields

MICRO:

- `gateway/dropdown/GetCustomFieldDropdown`
- `gateway/dropdown/GetCustomFieldDropdownByCode`
- `gateway/dropdown/GetCustomFieldControlByCode`

On save, custom fields are mapped into `CustomField[]` on the header JSON.

---

## 9. Module setting

```http
GET https://companyv4api.tebsys.com/FnGetQuoteModuleSetting
```

Used for tenant flags:

| Type | Data | Effect |
| --- | --- | --- |
| `AllCompany` | `Active` | Company/contact search uses `IsAll: true` |
| `ChangeContact` | `Active` | Contact stays editable after header save |
| `QuoteFor` | (payload) | B2B vs B2C title/contact behaviour |

---

## 10. Workflow, status, pipeline

| Call | Host | Use |
| --- | --- | --- |
| `FnGetWorkFlowDropdown` / `FnGetWorkflowByModule` | COMPANY | Assign workflow on add |
| `FnGetWorkFlowStatusWithWonLostDropdown?workflowId=&module=TEBQuote` | COMPANY | Status list for change-status |
| `AcGetWorkFlowStepsByWorkflow` | MASTER | Steps |
| `CHANGEQUOTESTATUS` | DYNAMIC `AcAddDetail` (screen `QUOTESTATUS` `ApiPostCall`; fallback `AcGetData`) | Change stage/status |
| `QUOTEVALIDATEFIELDS` | DYNAMIC AcGetData | Block invalid stage moves |
| Pipeline / funnel screens | same Quote module | Extra routes; list still keyed as `TEBQuote` |

Live Quote Status form posts:

```json
{
  "data": {
    "Module": "SalesManagement",
    "Code": "CHANGEQUOTESTATUS",
    "PrimaryKey": "<quoteId>",
    "Data": "{\"QuoteId\":\"...\",\"WorkFlowId\":\"...\",\"StatusId\":\"...\",\"AssigneeId\":[\"...\"],\"FromPipeline\":false,\"Notes\":\"\"}",
    "Action": "CHANGEQUOTESTATUS"
  }
}
```

`QUOTEVALIDATEFIELDS` can block invalid stage moves. Won/lost reasons stay on the View popup.
| Pipeline / funnel screens | same Quote module | Extra routes; list still keyed as `TEBQuote` |

Gateway stage APIs (`gateway/common/GetStageDetails`, …) exist in the shell for workflow admin; quote runtime mainly uses Dynamic actions above.

---

## 11. Action catalog (Dynamic)

Complete Action strings seen on the quote remote for Quote / items / view:

**Header / view:** `GETQUOTEDETAIL`, `QUOTEDETAILEDIT`, `QUOTEDEFAULT`, `GETQUOTEACTIVITY`, `QUOTEACTIVITY`, `ADD`, `COPYQUOTE`, `UPDATE`, `DELETE`, `CHECKDELETEPERMISSION`, `VIEWTOOLBAR`, `REV`, `ARC` / `ARCHIVE`, `CHANGEQUOTESTATUS`, `QUOTEVALIDATEFIELDS`, `GETPRICINGSCHEME`, `GETSTORYBOARD`, `GETCOMPANYCONTACTLIST`, `GETCUSTOMERLOCATIONLIST`, `GETCUSTOMERFINANCELIST`, `LEADSNOTES`, `GETMODULELASTNOTESREC`, `QUOTEDIARYBYID`, `GETLEADVIEW`, `QUOTEAUTOMATION`, `QUOTEAUTOMATIONFROMLEAD`

**Items:** `ADDITEM`, `ADDMULTIPLEITEM`, `REMOVEITEM`, `ADDITEMGROUP`, `REMOVEITEMGROUP`, `CHANGESEQUENCEITEMGROUP`, `ADDITEMTAX`, `REMOVEITEMTAX`, `GETITEMINFORMATION`, `ADDEDITITEMINFORMATION`, `GETCATEGORYDROPDOWN`, `VIEWITEM`, `VIEWCONSUMEDITEM`, `SAVECONSUMEDITEM`, `CONSUMEDITEMEDIT`, `TAXDROPDOWN`, `SPECIFICATIONDROPDOWN`, `GETITEMSPECIFICATIONMODULEWISE`

**Lookups:** `DROPDOWN`

**Payments / delivery (shared with order-style UI):** `DELETEPAYMENTSCHEDULE`, `DELETEDELIVERY`

---

## 12. End-to-end flows

### Manage → View

1. `POST DYNAMIC/AcGetData` unwrapped list (`Module: TEBQuote`).
2. Navigate to `/sales/quote/view/{Id}`.
3. `GETQUOTEDETAIL` (wrapped).
4. Lazy-load activity, pricing, storyboard, contacts, documents as the user opens those panels.

### Add

1. Load `QUOTEDEFAULT` plus dropdowns (type, site/location, workflow for that site, currency, owner = current user).
2. Company/contact: DROPDOWN on focus (empty keyword allowed); contacts scoped to company; first contact auto-selected.
3. Save header: Action `ADD` → read `value` as Id. Include `LocationId`, `WorkFlowId`, `OwnerId` when set.
4. Save items: `AcAddDetail` `ADDITEM` / `ADDMULTIPLEITEM` with that Id. Empty grid is invalid for process.
5. View-only work (storyboard, documents, notes, status, mail) happens after navigate to `/sales/quote/view/{id}`.

### View → Edit

1. `QUOTEDETAILEDIT` with `FORMTYPE`.
2. Patch the add form.
3. Save again with Action `ADD` and `PrimaryKey` / `Id` set (live still uses `ADD` for updates, not a separate `UPDATEQUOTE`).

### Copy

1. Load with `QUOTEDETAILEDIT`.
2. Save with Action `COPYQUOTE` and `IsCopyDocuments`.

---

## 13. Implementation notes for this repo

- Reuse `tebRequest` in `src/lib/api/client.ts` so auth refresh and headers stay consistent.
- `listQuotes` in `src/lib/api/quote.ts` uses the **unwrapped** manage body.
- `getQuoteDetail` / `saveQuoteHeader` / `getQuoteDetailForEdit` / `getQuoteDefaults` use the **wrapped** `{ data }` body.
- Always JSON.parse `Value` on view/edit/defaults. Always read lowercase `value` on save.
- Do not hide apps or invent Quote REST paths. Permission to open Quote is already in `GetMenuDetail`.
- One-page Add: Details + item add/remove. After header save (and on View), a bottom dock shows notes on the left (counts + pinned snippet; expand to compose) and an always-visible totals receipt on the right (Subtotal / Discount / Tax / Round off / Total). Live Highlights/Storyboard/Documents stay off this canvas.

---

## 14. One-page Add vs View (ingest map)

| Live surface | On one-page Add? |
| --- | --- |
| Details: company, contact, title, type, site, workflow, currency, dates, reference, description | **Yes** — key fields in front; extras behind More details |
| Defaults: site, workflow, owner, currency from `QUOTEDEFAULT` / current user | **Yes** — preload |
| Items: catalog search, add line, remove line, qty/price/discount/tax | **Yes** |
| Item groups, consumed/inventory, optional add-ons, spec pricing | No (later) |
| Notes (shared tools panel: list, add/edit, pin, privacy) | **Yes** — after header save / on View; not live View-tabs |
| Highlights, storyboard, contact/location/finance grids, documents, mails, activity, revise, send mail | **No** — live View only |
| Status | **Yes** — header status control |

There is no “remote items” tab. Add/remove catalog lines on Add; View shows totals in Highlights.

---

## 15. Source

Mapped from:

- `https://prodapps.teb.cloud/quote/remoteEntry.js?v=4.11.8.1`
- Quote module chunk (Angular `QuoteModule`): routes `manage`, `addquote`, `view/:id`, screen JSON for `QUOTE` / `MANAGE` / `ITEMQUOTE`
- Shared `dynamicApiPost` = `{ [ParamName]: payload }` with `ParamName: "data"`
- Shared manage `loadMicroApi` = unwrapped `{ Data, PageNumber, PageSize, SortColumn, SortOrder }`
