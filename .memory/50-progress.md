# Progress

## Done

- Mapped live auth from `live.teb.cloud` bundles (not from the mock Angular rewrite).
- Implemented Next.js login, refresh, logout, forgot-password, and GetMenuDetail shell.
- Quote API client mapped from the live quote remote (Manage/Add/View).
- One-page Add Quote composer: key fields + items, More details for the rest, draft timer, Process quote.
- Quote header save uses DYNAMIC `AcAddDetail` (not `AcGetData`); Quote header is separate from the App Top Bar.
- Quote View/item/defaults documented in `docs/quote-apis.md`. Company/contact lookup preloads; site, workflow, and owner default from `QUOTEDEFAULT`.
- Manage Quote full-width grid (`ManageGrid`): `TEBQuote` list, Grid View custom columns (`AcGetGridColumns` / `AcAddGridColumns` / `AcRemoveGridColumns`).
- Add Quote Items grid: live catalog ingest (`DROPDOWN` + `ItemId`), qty clamp, MANUAL price lock, inline/voucher discount, `TAXDROPDOWN`, `ADDITEM` (`PricePerUnit`), `REMOVEITEM`, reload `VIEWITEM` / `VIEWCONSUMEDITEM`.
- View Quote reuses the Add Quote composer (header + items), hydrated from `GETQUOTEDETAIL` / `QUOTEDETAILEDIT` and consumed items.
- Item lines persist unit price, inline/voucher discount, and tax (`ADDITEM` one row at a time on select/update, `ADDITEMTAX` when needed). Pricing-type icon switches available methods when the catalog exposes them.
- Quote view/post-save Add uses a bottom dock: notes on the left (counts, pinned snippet, expand to compose), always-visible totals receipt on the right. Actions is a placeholder. Not a sidebar and not live View-tabs.
- Quote header Save was removed from the chrome except overflow Edit: Save posts the header and closes the form. Company is locked after create; contact follows `ChangeContact`. Item lines persist on change.
- Item tax is multi-select (`Taxes[]`, scalar `ADDITEMTAX` on SalesManagement). Header Send email / View template are permission-gated icon notches. Status posts `QUOTE` / `QUOTESTATUS`. Dock Terms uses `QUOTETERMSANDCONDITION` MICRO term APIs.

- Quote mail, template, and terms use live ExtraApiCall paths
- Ask chatbot: NL → GetFilterControls + lookups → FilterValues / reporting FilterDetail → list or count report. No new backend.
- This clone converted to Ask-only: login + full-page chatbot. Quote routes and the app rail are not shown.
- Ask journey: first load lists permitted apps, then app/topic starter questions + search. Chat history persists in the browser (`localStorage`) and grounds follow-ups / GenAI. **All apps** returns to the picker without clearing the thread.
- Workforce Ask matches live team/route maps: Find my team plots last-known pins; Show route for me / Route of {username} plots that user’s tracked path.

## Next

- Keep Ask answers accurate against live APIs
- Do not rebuild Quote/manage screens in this clone
