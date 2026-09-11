# Technology

- Next.js App Router, React 19, TypeScript, Tailwind CSS 4
- Port 3000 (`npm run dev`)
- Hosts configured in `src/lib/api/hosts.ts` with optional `NEXT_PUBLIC_TEB_*` env vars
- No auth libraries: JWT decoded with `atob`, storage is `localStorage`
- HTTP: `fetch` wrapper in `src/lib/api/client.ts`
- Browser calls same-origin `/teb-api/{host}/…` (Next proxy to tebsys). That is why a published HTTPS origin does not need a new CORS allow-list.
- PWA: `src/app/manifest.ts`, `public/sw.js`, install prompt in `PwaProvider`. Users add TEB Ask to the home screen (Android Install / iOS Share → Add to Home Screen). Not a static export — `/api/ask/analyze` and the API proxy need a Node/Next host (Vercel).

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm start` (production)
- `npm run lint`

## Publish

Host Next.js on HTTPS (Vercel: import the repo, set `OPENAI_API_KEY` and any `NEXT_PUBLIC_TEB_*` overrides). PWA install only works on HTTPS (or localhost).
