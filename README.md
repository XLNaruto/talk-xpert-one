# One Talk

Realtime chat web app. Sibling to the **XpertOne** admin portal — same
architecture and conventions, separate repo, separate session, own theme.

## Getting started

```bash
npm install
cp .env.sample .env.development   # then fill in the API + socket URLs
npm run dev
```

The dev server runs on `--host`, so it's reachable from a phone on the same
network — worth using, since this is a mobile-first layout.

## Environment

Every var is declared in `.env.sample` and parsed in `src/config/env.ts`. The app
throws on boot if something required is missing, rather than failing later.

Set `VITE_APP_API_TARGET` in development to route requests through the Vite
reverse proxy at `/api` — same-origin, so no CORS and no cookie-scope surprises.
The proxy has `ws: true`, so the socket.io upgrade goes through it too.

`VITE_APP_COOKIE_PREFIX` **must** differ from the admin app's. It namespaces both
cookies and the IndexedDB database, and it's the only thing preventing the two
apps from overwriting each other's session on a shared origin.

## Architecture

Feature-based. Read `CLAUDE.md` before adding anything — it documents the folder
shape, where each kind of file belongs, and which patterns are deliberately
different from the admin app (no TanStack Query, cursor paging, own session).

```
src/features/auth/     email + password sign-in
src/features/chat/     conversation list, thread, composer, realtime stream
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server, development env |
| `npm run build` | lint + typecheck + build |
| `npm run lint` | oxlint |
| `npm run typecheck` | tsc -b |

## Status

Screens are wired end to end against the endpoint contract in
`src/lib/endpoints.ts`, but **the backend doesn't exist yet**. Each API call maps
snake_case DTOs in `features/<f>/lib/<f>-mappers.ts`; when the real API lands,
change the mapper and the endpoint path and nothing else.
