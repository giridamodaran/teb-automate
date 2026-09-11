# Project charter

## Why

Rebuild the TEB Cloud UI so we can iterate quickly (vibe-coding) without waiting on the Angular microfrontend rewrite, while keeping the production tebsys APIs unchanged.

## Success

- A user can sign in with a live TEB Cloud account and land on Ask.
- Session survives reload; expired JWT is refreshed; sign-out clears storage.
- Ask answers questions from live tebsys APIs (no new backend resources).

## Constraints

- Zero backend changes.
- Do not persist passwords (remember email only).
- Send only CORS-allowed headers: authorization, content-type, type, deviceinfo, deviceaddress, apihitdate.
