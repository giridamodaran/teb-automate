# Active focus

This clone is **TEB Ask** only: sign-in then a full-page chatbot. Quote composer, manage grid, and the app rail are not part of the UI.

Ask is a **two-step journey** (`src/lib/chat/journey.ts`, `ChatPanel`): first load asks “What do you want to know today?” and lists **permitted apps** from `GetMenuDetail`. If the live menu is empty, Ask still shows Sales / Service / Finance / Workforce / Reports so the picker is never stuck. Picking an app shows starter questions plus a search box. **All apps** returns to the picker without wiping the thread. History is stored on this browser in `localStorage` (`teb.ask.journey.{UserId}`) — not a TEB database. **Clear chat** wipes the thread and charts. Last turns are sent to `/api/ask/analyze`.

Ask also understands **Management Dashboard** (`TEBDashboard`, `/sales/dashboard`). That stack POSTs an unwrapped `FilterDetail` to MICRO `gateway/reporting/{Method}` — not Manage `FilterValues`. Toolbar: DATEFILTER, OWNERFILTER, assignee, workflow, location, items, FilterId. No entity → `GetTeamBasedRecordsCount` (team snapshot). Entity snapshot → `GetModuleWiseOverviewDashboard` (`QUOTESNAPSHOT`, `LEADSNAPSHOT`, …) then `GetTeamBased*Details`. Phrases: `Team snapshot this month`, `Quote snapshot owned by me last 7 days`, `What filters can I use on the dashboard?`.

Ask uses live Created Filter modes (`ANY` / `WITHIN` last N days-months-years / `BETWEEN` / `FINANCIALPERIOD`) on TabCode `DATE`, charts the filtered set, and asks `/api/ask/analyze` (OpenAI or Anthropic) for commentary. Opportunity lists that 400 on unwrapped `TEBSale` FilterValues fall back to SalesManagement `MANAGE` (FilterModule) or an unfiltered list with the date applied locally. Error answers include clickable follow-up chips.

Ask entities: Quote, Lead, Opportunity, Order, Invoice, Receipt, Service Ticket, Work Order, Action (`TEBAction` / `GetTeamAndMemberBasedActionDetails`), Workforce. **Find my team** matches live `/workforce/team`: Workforce user dropdown → `GetSignedInUsersLastLocation` → OSM pins. A named user uses `GetUserLastLocation`. **Show route for me / Route of {username}** matches `/workforce/route`: `GetUserTrackingMapView` (`TrackLogRequest` UserId + CurrentDate) and plots MarkerList + PolylineList. Field logins often get an empty TEBWorkforce dropdown; Ask falls back to team-member APIs and matches people on `UserId` / username.

This login’s snapshot payload is team rows with nested `AppWiseCount` / `TotalCount` (not `Count`), so Ask showed **0**. Calendar dates used `DatePeriod.Period: null`, which 400s on reporting. Fix: flatten app counts, send `Period: 0`, and fall back to `GetTeamBased*Details` / unfiltered MANAGE when FilterValues are rejected (`Filter form not created`).

Money in Ask uses the same mapped currency as the Quote APIs (INR `Rs` → `₹`). Do not default GenAI amounts to `$`.

After login the user always lands on `/`. `/sales/...` redirects to `/`.

Publish as Next.js on HTTPS (not a static SPA zip). Mobile users install it as a **PWA**: Android “Install app”, iPhone Share → Add to Home Screen. Manifest + service worker live in `src/app/manifest.ts` and `public/sw.js`.
