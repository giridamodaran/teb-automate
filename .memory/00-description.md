# TEB Ask

TEB Ask is a **login + chatbot** frontend for TEBillion’s CRM/ERP. It talks to the **existing production APIs**. The live Angular product remains at `https://live.teb.cloud`; this app does not replace that UI.

## Scope

In scope: sign-in, session, logout, forgot-password, and the Ask chatbot (plain-language questions over live Quotes, Leads, Opportunities, Orders, Invoices, Receipts, Service Tickets, Work Orders, Actions, and Workforce).

Out of scope: Quote composer, manage grids, app rail, and other module screens.

## Constraints

- No backend code or API contract changes.
- Browser origin for local development is `http://localhost:3000` (already CORS-allow-listed).
- Authorization stays JWT Bearer in `localStorage`, matching the live Fuse app.
