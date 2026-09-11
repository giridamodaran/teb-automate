# TEB Cloud frontend

New Next.js frontend for TEB Cloud. It uses the **existing live APIs** (`*.tebsys.com`) with **no backend changes**.

This slice covers:

- Sign in (`POST gateway/admin/GetLogin`)
- Session restore, JWT refresh, and sign out
- App shell navigation from `GetMenuDetail`

Feature modules (Lead, Dashboard, Orders, …) are placeholders until the next slice.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Port **3000** is required so the live APIs’ CORS allow-list matches.

Optional host overrides live in `.env.example`. Copy to `.env.local` only if you need non-production endpoints.

## Auth contract (live)

- Login body: `{ UserName, Password }` (UserName is the email)
- Token: `localStorage.accessToken` from `Data.JWTToken`
- User: `localStorage.CURRENTUSER` from `Data.UserDetail`
- Authenticated headers: `Authorization: Bearer …`, `Type: WEB`, `DeviceInfo`, `DeviceAddress`, `ApiHitDate`
- Refresh: `GET gateway/admin/RefreshToken` → `Data.Token`
- Logout: `POST userv4api…/AcLogout` `{ loginDetail: { Id } }`
