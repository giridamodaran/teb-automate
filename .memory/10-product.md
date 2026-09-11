# Product

## Users

TEB Cloud subscribers: sales, operations, field users, and tenant admins (`IsAdmin === 1`).

## Journeys

1. Open `/` while logged out → redirect to `/sign-in`.
2. Submit email + password → `GetLogin` → store JWT + user → bootstrap session → land on Ask (`/`).
3. Forgot password → generic success message whether or not the email exists.
4. Ask a question → live filters / reporting / workforce APIs → charts + GenAI analysis.
5. Sign out → `AcLogout` then clear session.

## UX

- Login layout matches live TEB: logo, email, password, remember me, help/privacy links, blue marketing panel.
- Password rules match live: 7+ chars, upper, lower, digit, special `!@#$%^&*`.
- Authenticated app is Ask only: header (title, user, sign out) and a full-page chat. No app rail or Quote screens.
