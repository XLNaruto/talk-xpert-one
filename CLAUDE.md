# CLAUDE.md — XpertOne Talk

Guidance for Claude Code. Modular, **feature-based** architecture — the same
folder shape and naming as the XpertOne admin portal, with a data layer built
for realtime chat instead of CRUD screens.

## Stack

- **React 19 + Vite + TypeScript** (strict)
- **react-router-dom 7** — route objects in `routes/app-routes.tsx`
- **Zustand** — all client state, including the message cache
- **socket.io-client** — realtime transport, behind `lib/socket-client.ts`
- **IndexedDB** (`idb-keyval`) — offline message cache + encrypted session
- **Tailwind v4 + shadcn/ui** — styling & components
- **Axios** — HTTP · **Zod** — validation · **react-hook-form** — forms
- **react-virtuoso** — the virtualised message list
- **oxlint** — linting (no ESLint in this repo)

## Relationship to XpertOne admin

Separate repo, separate deploy, separate session. **No shared package, and no
imports between the two projects** — ever.

What is deliberately kept identical, so code reads the same in both and a
primitive can be copied across unedited:

- folder layout, file naming, `@/` alias, `components.json`
- CSS **token names** in `globals.css` (`--background`, not `--color-background`)
- `config/env.ts` zod-parse-or-die, `lib/endpoints.ts`, dev reverse proxy
- feature folder shape and the hooks-own-the-logic rule

What is deliberately different:

- **No TanStack Query and no TanStack Router.** Do not add them. Messages arrive
  over a socket into a Zustand cache; a request/response cache is the wrong tool
  for a feed the server pushes.
- **Two paging shapes, and messages get the unusual one.** Chats, members, media,
  search and blocks page by `limit`/`offset` — `ListPage<T>` in `types/api.ts`.
  MESSAGES page by message **id**: `before_id` walks up through history and
  `after_id` replays the gap after a reconnect. New rows arrive constantly, so an
  offset would skip or repeat between requests. That is `MessagePage<T>`.
- **No response envelope.** Talk answers `{ items, total }` or the record itself
  at the top level. There is no `{ data }` to unwrap and no `unwrap()` helper.
  Errors are `{ code, message, details? }` — see `lib/api-error.ts`.
- **Own theme** — sky (`#0ea5e9`), on a blue-tinted base with its own chat
  bubble tokens.
- **Own session** — different cookie prefix, different IndexedDB database, no SSO
  with admin.

## Current status

Two routes, wired against the **live** Talk API (`/talk/docs` for the OpenAPI
document, `TALK-IMPLEMENTATION.md` for the rules behind it):

| Route | Feature folder | Notes |
|---|---|---|
| `/login` | `features/auth/` | email + password + mandatory `platform` |
| `/chat` | `features/chat/` | list, thread, composer, groups, media, search |

### People come with names and photos — but there is still no directory

Every person-shaped field carries a `name` and a `photo` **beside** its integer
id: `sender_name`/`sender_photo` on a message and on its inline `reply_to`,
`counterpart_*`, `created_by_*`, `last_message_sender_*`, `blocked_by_*`,
`pinned_by_*`, and a plain `name`/`photo` pair on a member, a receipt, a presence
row and a block. `GET /talk/me` and the login answer your own. Both fields are
nullable — `name` is null when the master record is gone — and **`photo` is a
storage KEY**, so it goes through `useMediaUrl()` like every other `*_url`.

So a screen draws a person from the payload it already holds. Two things do not
carry a name: `talk.typing.*` and `talk.presence`, which are `{ chat_id,
talk_user_id }` and `{ talk_user_id, is_online, at }`. `stores/talk-directory-store.ts`
is the cache that closes that gap — every REST read feeds it on the way past, and
the typing indicator looks a person up there.

What is still missing is a DIRECTORY: nothing lists the account's Talk
identities. So the pool for a new group is the people we have already seen, plus
a typed id.

`features/chat/lib/talk-directory.ts` remains the single seam that decides how a
person is WRITTEN — `resolveTalkUser(id, name, photo)`, falling back to
`Member 42` for a nameless record, and `selfLabel` for yourself. **Change that
file, not the components.**

### Things the API cannot do, so the UI does not offer them

- **Starting a chat with a stranger.** `POST /talk/chats/direct` needs a
  `talk_user_id` and there is still nothing to browse, so `PeoplePicker` offers
  everyone we have a name for — direct-chat counterparts, plus anyone a member
  list or a message has named — and a typed-id field. The server drops ids
  outside the account, so a wrong one is ignored rather than added.
- **Jumping to an old search hit.** History pages by id from the newest end, so
  `MessageSearchDialog` opens the hit's conversation instead of scrolling to it.
- **Retrying a failed attachment.** The `File` does not survive a reload, so a
  failed media send asks for the file again; a failed text send replays as-is.

## Non-negotiable rules

1. **Server data → the feature's `api/` hooks. Client/UI state → Zustand.**
   There are exactly **three** deliberate overlaps, all because the socket has to
   read or mutate them and a list held in a hook's `useState` is unreachable from
   an event handler: `stores/message-cache-store.ts` (also the offline store),
   `stores/chat-list-store.ts`, and `stores/talk-directory-store.ts` (id → name +
   photo, so the two nameless socket events can still print a person). All three
   **cache only** — the axios call still lives in `features/chat/api/`, which
   writes into them.
2. **Components never call `fetch`/`axios`/`io` directly** — they call a hook from
   the feature's `api/`, which calls a function in `<thing>-api.ts`.
3. **All REST paths live in `lib/endpoints.ts`; all socket event names live in
   `features/chat/constants.ts`.** Never a string literal at a call site.
4. **New feature = new folder under `src/features/`** with `api/`, `components/`,
   `hooks/`, `lib/`, `pages/`, `types/`, `constants.ts`, `schemas.ts`, `index.ts`.
5. **Cross-feature imports go through the feature's `index.ts`**, never deep paths.
   `import { ChatSidebar } from '@/features/chat'` — not `.../components/chat-sidebar`.
6. **`@/` alias**, never long relative chains. (`../` inside the same feature is fine.)
7. **Screen logic lives in `features/<n>/hooks/`** — `use-<thing>-list.ts`,
   `use-<thing>-form.ts`, `use-<thing>-input.ts`. Pages and components lay out
   markup and nothing else. If a component has a `useState` that isn't purely
   visual, it belongs in a hook.
8. **`features/<n>/lib/`** holds pure helpers — mappers, formatters, derivations.
   No React, no hooks, no store reads in that folder.
9. **Zustand stores stay small and single-concern**; select narrowly
   (`useChatStore((s) => s.drafts)`, never the whole store).
10. **socket.io is only imported in `lib/socket-client.ts`.** Connection lifecycle
    is `app/providers/socket-provider.tsx`; event subscriptions belong to the
    feature that cares (`features/chat/hooks/use-message-stream.ts`, mounted once
    by `chat-layout.tsx`). The gateway addresses rooms to the **person**, not to a
    screen, so a second subscription double-handles every event — and you receive
    an echo of **your own** sends, which is why the cache merges by `id` and by
    `client_message_id`.
    Three more rules that are load-bearing and easy to lose:
    - **Fetch, then `talk:join`.** A join with no preceding read is refused; the
      read is what issues the Redis grant. Rooms do **not** survive a reconnect.
    - **Re-join on every `connected`**, first connect included. Skipping it looks
      exactly like a healthy socket that delivers nothing.
    - **Re-handshake after every token refresh** (`updateSocketToken`). The socket
      never refreshes its own token and dies silently at the half-hour otherwise.
11. **Anything stored locally goes in IndexedDB — never `localStorage`/
    `sessionStorage`.** Persisted stores use `createJSONStorage(createIdbStorage)`
    from `lib/idb-storage` (`createIdbSessionStorage` for anything holding
    credentials — it adds encryption). IndexedDB is async, so those stores set
    `skipHydration: true` and are rehydrated in `main.tsx` before the app mounts.
    **Add every new persisted store to that `Promise.all`.**
12. **Never put a record id in the path.** No `/chat/:conversationId`. The active
    conversation lives in `chat-store`; anything a URL must carry rides in a
    single encrypted `?data=` token via `encryptId`/`decryptId` from `lib/crypto`.
13. **All cookie access goes through `lib/cookie.ts`**, which namespaces by
    `VITE_APP_COOKIE_PREFIX`. Touching `document.cookie` directly risks
    clobbering the admin app's session on a shared origin.
14. **Env only through `config/env.ts`** (zod-parsed, fail-fast). Never
    `import.meta.env.X` at a call site.
15. **Optimistic sends never silently vanish.** A failed message flips to
    `status: 'failed'` and stays visible so the user can retry. Every send carries
    a fresh `client_message_id`, which is what makes the request idempotent and
    what reconciles the bubble against both the HTTP response and the socket echo.
16. **Tokens: one refresh in flight, ever.** The refresh token ROTATES and each
    works exactly once, so `lib/auth-refresh.ts` is single-flight and persists the
    new pair before anything replays. A **401 buys one refresh-and-replay; a 403
    stops** — it means suspended, or blocked from posting. Never send the refresh
    token anywhere but `/talk/auth/refresh`.
17. **`platform` is mandatory on login and is always `WEB` here** (`lib/platform.ts`).
    Talk allows one live session per OS; a browser claiming `MAC` would retire a
    signed-in desktop app.
18. **Attachments go direct to storage in three steps** — presign, `PUT` with the
    exact `Content-Type` and byte count, then send the returned `key` as
    `media[].file_url`. Max 25 MB, and the size is signed into the URL. Bytes never
    pass through the API; see `lib/uploads.ts`.
19. **Every `*_url` the API returns is a storage KEY, not a URL.** Read it through
    `useMediaUrl()` / `mediaUrl()`, which prefix the server's `media_path`.
20. **Typing is a socket emit, throttled by the client.** At most one
    `typing: true` every few seconds, never per keystroke, and the indicator is
    expired on a ~5 s timer rather than trusting `talk.typing.stop`.
21. **`talk.presence` is broadcast to the whole account** and must be filtered to
    the people actually on screen.

## Feature folder shape

```
<feature>/
├── api/            <thing>-api.ts (raw axios) + use-<thing>.ts hooks
├── components/     presentational pieces only
├── hooks/          screen logic — use-<thing>-list.ts, use-<thing>-form.ts
├── lib/            pure helpers: <thing>-mappers.ts, <thing>-formatters.ts
├── pages/          screens — layout driven by the hooks
├── types/          UI-facing types (index.ts)
├── constants.ts    socket events, page sizes, EMPTY_<THING>_FORM
├── schemas.ts      zod schema + inferred FormValues
└── index.ts        the feature's public surface
```

Shared form/layout primitives live in `components/common/` — `Field`
(`form-field.tsx`), `EmptyState`, `BrandLogo`, `OnlineBadge`, `LoadingScreen`,
`Modal`. Don't re-declare a local `Field` or a local dialog inside a feature.

## Folder structure

```
src/
├── app/            providers, router re-export, layouts (auth + chat shell)
├── routes/         route objects, guards (PrivateRoute / PublicRoute), 404
├── features/
│   ├── auth/         email + password sign-in
│   └── chat/         conversation list, thread, composer, realtime stream
├── components/     ui/ (shadcn), common/ (shared app pieces)
├── lib/            api-client, api-error, api-toast, auth-refresh, socket-client,
│                   uploads, platform, cookie, crypto, idb-storage, endpoints,
│                   config-api/-mappers, logger, utils, validation
├── stores/         GLOBAL zustand: auth, chat, chat-list, message-cache,
│                   talk-directory, config, media-viewer, ui
├── hooks/          app-wide: use-app-config, use-debounced-value, use-is-mobile,
│                   use-online-status
├── config/         env.ts (zod), api-proxy.ts
├── types/          api.ts (Id, ListPage, MessagePage), config.ts
└── styles/         globals.css — the design tokens
```

## Where a new file goes

| You're adding | It goes in |
|---|---|
| A new screen (e.g. group settings) | `features/<feature>/pages/<feature>-<kind>-page.tsx` + a route in `routes/app-routes.tsx` |
| A new endpoint call | path in `lib/endpoints.ts`, function in `features/<f>/api/<f>-api.ts`, hook in `features/<f>/api/use-<thing>.ts` |
| A DTO → UI mapping | `features/<f>/lib/<f>-mappers.ts` |
| A date/text formatter | `features/<f>/lib/message-formatters.ts` (chat) or `lib/utils.ts` (app-wide) |
| Screen state / a submit handler | `features/<f>/hooks/use-<thing>-*.ts` — **not** in the component |
| A new socket event | name in `features/chat/constants.ts`, handler in `use-message-stream.ts` |
| A way to label a person | `features/chat/lib/talk-directory.ts` — nowhere else |
| A name for an id with no name in the payload | `stores/talk-directory-store.ts` (typing and presence only) |
| A file upload | a presign path in `lib/endpoints.ts`, then `uploadFile` from `lib/uploads.ts` |
| A dialog | `Modal` from `components/common/modal.tsx` |
| A shadcn primitive | `npx shadcn@latest add <name>` → `components/ui/` (don't hand-write) |
| A shared app component | `components/common/` |
| A component used by one feature | `features/<f>/components/` |
| A new global store | `stores/<name>-store.ts` + `main.tsx` rehydrate list if persisted |
| A new env var | `config/env.ts` schema **and** `.env.sample` |
| A colour or radius | `styles/globals.css` — a token, never a hard-coded hex in a component |

## Conventions

- Files kebab-case; components PascalCase; hooks `useX`; stores `useXStore`.
- Page files are `<module>-<kind>-page.tsx`; the component is `<Module><Kind>Page`.
- Query/mutation hooks: `use<Thing>` for reads, `use<Action>` for writes.
- Forms: react-hook-form + Zod resolver, inline field errors via `Field`.
- DTO interfaces are named `<Thing>Dto` and live beside their mapper.
- Dates cross boundaries as **ISO strings**, never `Date` — they have to survive
  an IndexedDB round-trip.
- Tailwind only, via tokens. No inline `style`, no arbitrary hex.

## UI and copy

- Active voice, sentence case. A button says what happens: "Send", not "Submit".
- An empty screen is an invitation to act — say what to do next.
- Errors state what went wrong and how to fix it. They don't apologise.
- Accessibility floor: visible focus ring (already global), `aria-label` on every
  icon-only button, keyboard-reachable everything, reduced motion respected.

## Scripts

```bash
npm run dev        # vite --mode development --host
npm run build      # oxlint && tsc -b && vite build
npm run lint       # oxlint
npm run typecheck  # tsc -b
```

## Before finishing any task

- `npm run build` passes — no TS errors, no oxlint errors.
- No `axios`/`io`/`fetch` in a component; no `document.cookie` outside `lib/cookie.ts`.
- No `localStorage`/`sessionStorage` anywhere.
- New persisted store added to the `main.tsx` rehydrate list.
- New endpoint went through `lib/endpoints.ts` + a feature `api/` hook.
- No TanStack Query or TanStack Router added.
- No `talk.`/`talk:` event string outside `features/chat/constants.ts` and
  `lib/socket-client.ts`; no `/talk/...` path outside `lib/endpoints.ts`.
- A new `*_url` field from the API is rendered through `useMediaUrl()`, not raw.
- A new `photo` field is treated the same way — it is a storage key, not a URL.
- A new read that carries `name`/`photo` calls `rememberPeople` in its
  `features/chat/api/` function, so typing and presence keep resolving names.
- If you touched the socket or the token flow, re-read §9 of
  `TALK-IMPLEMENTATION.md` and check all eleven client responsibilities still hold.
