# Progress

## Done

- Mapped live auth from `live.teb.cloud` bundles (not from the mock Angular rewrite).
- Implemented Next.js login, refresh, logout, forgot-password, and GetMenuDetail bootstrap.
- Ask chatbot: NL → GetFilterControls + lookups → FilterValues / reporting FilterDetail → list or count report. Company/Contact use `GetCustomerDetail` + `getcustomerdetails` + `GETCOMPANYDETAIL` / `GETCONTACTDETAIL` (phone/email click-to-call cards). Quote view in Ask is read-only (`GETQUOTEDETAIL`, `VIEWCONSUMEDITEM`, templates, notes, activity) plus an Open-in-TEB link to live.teb.cloud. Template PDFs preview in chat via TEMPLATE `AcDownloadPdf`. Items and totals show as a receipt card. No new backend.
- This clone is Ask-only: login + full-page chatbot. Quote composer, manage grid, notes/tools, and the app rail source were removed (2026-09-11).
- Ask journey: first load lists permitted apps, then app/topic starter questions + search. Chat history persists in the browser (`localStorage`) and grounds follow-ups / GenAI. **All apps** returns to the picker without clearing the thread.
- Workforce Ask matches live team/route maps: Find my team plots last-known pins with street addresses (`CurrentAddress` / `StartAddress`), not `0` or lat/long; names come from the user dropdown, not UserIds. Show route for me / Route of {username} plots start/end pins plus that user’s tracked path. **People started {date}** is punch-in (Workforce card Start Day + Day Manage tracking), not joining date.
- `/teb-api` proxy requires Authorization except GetLogin / forgot-password; `/api/ask/analyze` requires a Bearer JWT.

## Next

- Keep Ask answers accurate against live APIs
- Do not rebuild Quote/manage screens in this clone


## Next

- Keep Ask answers accurate against live APIs
- Do not rebuild Quote/manage screens in this clone
