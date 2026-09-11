# System architecture

## Live production (unchanged)

- UI shell: `https://live.teb.cloud` (Fuse Angular 14, S3/CloudFront)
- Remotes: `https://prodapps.teb.cloud/{module}/remoteEntry.js`
- APIs: `mastersv4api`, `companyv4api`, `userv4api`, `dynamicv4api`, `templatev4api`, `webconnectorv4api`, `gateway.tebsys.com`

## This frontend

Next.js App Router. In the browser the UI calls same-origin `/teb-api/{host}/…`, which the Next server proxies to tebsys. Unauthenticated proxy use is limited to GetLogin and forgot-password. `/api/ask/analyze` stays on the Next server (OpenAI/Anthropic keys) and requires a Bearer JWT.

## Session keys (parity with live)

accessToken, CURRENTUSER, MENU, SETTING, SCREENDETAIL, SUBSCRIBERUSER, PINNEDMENU, TEBAgmKey

## Navigation

This app is Ask-only. After login the user lands on `/`. `GetMenuDetail` still runs during bootstrap (session parity) but is not shown as a rail. Old Quote paths (`/sales/...`) redirect to `/`.
