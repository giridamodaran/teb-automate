# Decisions

## 2026-08-26 — Call live tebsys APIs; do not use teb-cloud-ui-master mocks

The Angular rewrite only implements UI mocks. Real contracts live in the Fuse app at live.teb.cloud.

## 2026-08-26 — Next.js on port 3000

CORS preflight on GetLogin already allows `http://localhost:3000` with credentials.

## 2026-08-26 — Bearer token in localStorage

Matches live interceptor (`Authorization: Bearer` + `Type: WEB` + device headers). Do not invent cookie-session auth (would require backend changes).

## 2026-08-26 — Omit Latitude/Longitude headers

Live app sends them; the CORS allow-list for a new origin does not include them.

## 2026-08-26 — Quote uses Dynamic AcGetData, not a dedicated Quote REST resource

The live quote remote dispatches through `dynamicv4api.tebsys.com/AcGetData` with Action codes (`GETQUOTEDETAIL`, `QUOTEDETAILEDIT`, `ADD`, `COPYQUOTE`). Manage list posts an unwrapped paging body to the same URL with `Module: TEBQuote`. Do not invent a new Quote backend.

## 2026-08-27 — Manage grids are a shared component

List screens (Quote first, then Lead/Order/…) use `ManageGrid`. Column show/hide/reorder persist with live COMPANY `AcGetGridColumns` / `AcAddGridColumns` / `AcRemoveGridColumns` per user and screen. Do not hardcode a Quote-only table.

## 2026-08-27 — View Quote reuses the Add composer

`/sales/quote/view/:id` is not the live View-tab workspace. It hydrates the same header + items composer used after Add Quote header save, via `GETQUOTEDETAIL` / `QUOTEDETAILEDIT` and consumed items. Do not apply `QUOTEDEFAULT` when an id is in the URL.

## 2026-08-27 — Notes are a reusable entity tool

Quote, Lead, and Order share the Notes module. The composer tools panel takes `{ entityId, module }` and calls MICRO `GetSubscriberNotes` / `getnotesapps` plus DYNAMIC `Notes` `NOTESMANAGE` (`ADD` / `DELETE` / `PINNOTE`). Do not list notes with Quote `LEADSNOTES`. No WYSIWYG in v1 (textarea).

## 2026-08-27 — Icon + word, not icons-only

Use Material Symbols (already in the shell) via `src/components/ui/Icon.tsx`. Rails and toolbars: icon + short label + count. Pin/delete/close/collapse/settings: icon-only with aria-label. Form fields, money, and pinned snippets stay words. Do not add a second icon pack.

Do not copy live View tabs, the right-side notes dialog, or an always-on 360px sidebar. After header save, a collapsed ~40px rail above totals shows note/pin/action counts and one pinned snippet. Expand to ~220px for compose + list. Default collapsed so the items table keeps full width.

## 2026-08-28 — Quote header saves on the fly after first create

The header Save button only uniquely created the quote, posted header fields, and closed edit mode. Item lines already persist on change, so a second Save was re-posting every line. Keep empty-state **Save quote** for the first `ADD`. Overflow **Edit** reopens the header; **Save** posts `ADD` with Id and closes the form. Company is locked after create. Contact stays editable only when `ChangeContact` is Active.

## 2026-08-28 — Quote totals are a pull-up receipt

Do not keep Subtotal / Discount / Tax / Total in a horizontal footer, and do not float a totals card over the items grid. Collapsed footer always shows Total; pull up for the vertical receipt (Subtotal, Discount, Tax, Round off, Total). Notes stay the rail above this footer. Round off stays 0 until `gateway/order/RoundOffTotalAmount` is wired.

## 2026-08-28 — One accordion at the bottom; totals stay visible

Two stacked collapse controls (notes + totals) made the bottom chrome unclear. Totals are not optional context — they are the outcome of the quote — so they stay on screen as a compact receipt on the right of the bottom dock. Notes remain the only expand on the left. Do not add a second chevron for money.

## 2026-08-28 — Dock default open; close hides notes and the receipt

## 2026-08-28 — Quote mail, template, and terms use live ExtraApiCall paths

Do not invent mail/template/terms REST resources. Send email is `QUOTEMAIL` + MICRO `gateway/quote/SendMailToCustomers`. PDF preview is TEMPLATE `AcDownloadPdf` `SAVETEMPLATE`. Quote “delivery terms” are Terms & Conditions (`QUOTETERMSANDCONDITION` / `gateway/term/*`). Order `DELIVERY` / `getorderdeliveries` is not on Quote.

## 2026-08-28 — Quote status save uses Module EstimationManagement / Code QUOTESTATUS

Live `Tw.QUOTE` is **`EstimationManagement`**, not the screen code `QUOTE`. `saveDetail` posts `AcAddDetail` `{ Module: EstimationManagement, Code: QUOTESTATUS, PrimaryKey: "", Action: CHANGEQUOTESTATUS, Data: { QuoteId, WorkFlowId, StatusId, AssigneeId: [id], FromPipeline, Notes } }`. Screen FixedData `SalesManagement` / `CHANGEQUOTESTATUS` is metadata only. Assignee is required.

## 2026-08-28 — Extra item taxes stay on EstimationManagement

Do not post quote `ADDITEMTAX` to `SalesManagement` — that 500s with “contact system administrator.” Use EstimationManagement like `ADDITEM`. Payload `{ EntityId, EntityItemId, TaxId }` (scalar, then `[id]`). If `ADDITEMTAX` still fails, re-save the line with `TaxIds` / `Taxes` on `ADDITEM`.

## 2026-08-28 — Send email and View template are always-visible header icons

Show the mail and template notches whenever the quote is saved. Disable them when `VIEWTOOLBAR` / `ITEMCONSUMEPERMISSION` does not include `SENMAIL` / `EXPORTPDF`. Do not hide them. Overflow stays Edit / Copy / Revise / Archive / Delete.

## 2026-09-11 — Ask starts from permitted apps, not a blank prompt

The chatbot is the product. First load lists apps the user can open (`GetMenuDetail` → `permittedApps`). Selecting an app (or a topic inside it) sets the journey so follow-ups stay grounded. Thread text is kept in `sessionStorage` and passed into GenAI analysis. **All apps** is a journey reset, not a new chat. Do not rebuild the app rail for this.

## 2026-09-10 — Ask chatbot uses live Filter APIs, not a new report service

Natural-language questions are parsed in the browser, names are resolved through existing lookups (`listOwners`, workflows, stages, `GetFilterControls`), then posted as Manage `FilterValues` on unwrapped DYNAMIC `AcGetData` (`Module: TEBQuote` etc.) with `FilterId: null`. Counts can also hit MICRO `gateway/reporting/GetTeamBased*`. Do not add an LLM backend or new REST resources. Follow-ups without an entity merge onto the last intent.

## 2026-08-28 — Quote PDF preview uses TEBQuote on TEMPLATE AcDownloadPdf

Live `getTemplateDetail` posts `{ Module: TEMPLATE, Code: TEBQuote, Action: SAVETEMPLATE, Data: { EntityId, Module: TEBQuote, TemplateId } }`. `a2.EstimationManagement` is `TEBQuote`, not `EstimationManagement`. Empty `Value` is “Template URL was not returned.” Read `Value` even when it is nested JSON (`Url` / `FileUrl`).


