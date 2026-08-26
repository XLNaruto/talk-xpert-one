# CLAUDE.md — XpertOne Talk

Guidance for Claude Code. Modular, **feature-based** architecture — the same
folder shape and naming as the XpertOne admin portal, with a data layer built
for realtime chat instead of CRUD screens.

## Stack

- **React 19 + Vite + TypeScript** (strict)
- **react-router-dom 7** — route objects in `routes/app-routes.tsx`
- **Zustand** — all client state, including the message cache
- **socket.io-client** — realtime transport, behind `lib/socket-client.ts`
- **IndexedDB** (`idb-keyval`) — persisted stores + encrypted session
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
  Opening a thread is neither: `limit: -1` (`MESSAGE_OPENING_LIMIT`) answers with
  twenty read messages plus EVERY unread one — a hundred when there is nothing
  unread — so the divider always arrives in the first read and there is no
  "load newer" direction. Only `before_id` pages, `MESSAGE_PAGE_SIZE` (500) at a
  time.
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

Push notifications are a feature without a route — `features/notifications/`,
mounted by `chat-layout.tsx`. See "Push is the same events, delivered twice".

### People come with names and photos, and there is now a directory

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

`GET /talk/contacts` is the DIRECTORY — everyone I may start a chat with,
alphabetically, with a server-side `search` over the name AND the Talk login,
`company_id` / `department_id` filters and `limit`/`offset` paging. Reach is read
live per request and is GRANTED, never assumed, so an empty list is a real answer
(no grants) rather than a failed read; a row also carries `existing_chat_id`, my
current direct chat with that person. It is `features/chat/api/use-contacts.ts`,
and it is what `PeoplePicker` is built on — searching it is a REQUEST, never a
filter over the loaded page.

`features/chat/lib/talk-directory.ts` remains the single seam that decides how a
person is WRITTEN — `resolveTalkUser(id, name, photo)`, falling back to
`Member 42` for a nameless record, and `selfLabel` for yourself. **Change that
file, not the components.**

### A system message carries its operands, and has no sender

A `system` row has `sender_talk_user_id: null` — it belongs to the conversation,
not to a person. It answers `body` as a READY-TO-RENDER sentence ("Minato created
the group and added Draco Employee") **and** `system_data` as the operands it was
rendered from: `by_talk_user_id`/`by_name`/`by_photo` (the actor), `members[]`
with the name and photo each person had AT THE TIME, and per-event extras
(`from`/`to` on a rename).

`features/chat/lib/system-messages.ts` renders from the OPERANDS for the five
codes it knows (`group_created`, `group_renamed`, `member_added`,
`member_removed`, `member_left`), because only the client knows who is reading
and can write "You added Draco". An unrecognised code maps to `systemEvent: null`
and falls through to the server's sentence — never onto a guessed event. Those
names also feed `rememberPeople`, so typing and presence still resolve.

### A group's authority is SHAREABLE, and the owner can leave

`member_role` is still `owner` | `admin` | `member`, but **`owner` and `admin` now
hold exactly the same powers over the MEMBERSHIP** — add, remove, mute, appoint
further admins. The one difference is the TARGET: **the `owner` row is
untouchable**, by an admin and by the owner on their own row, which is what makes
appointing an admin a delegation rather than a gamble. Two powers stay
owner-only: rename/edit (`PATCH /talk/chats/{id}`) and disband. So the screens
gate on TWO questions, never one — `canManageMembers` and `canEditGroup` in
`features/chat/lib/member-roles.ts`, which is the only file that decides either.

`PUT /talk/chats/{id}/members/{talk_user_id}/role` (or `talk:member.role`) takes
`admin` or `member` and nothing else — `owner` is a 422, because it moves only by
SUCCESSION. It is **idempotent**: setting a role somebody already holds writes
nothing and announces nothing, so the item is never disabled after a tap. It
refuses the owner's row, your own row, and a plain-member caller, which is why
`canActOnMember` collapses all three into one answer and no request is made.

The owner may now **leave**, and the group is handed on in the same operation: the
longest-standing remaining **admin**, else the longest-standing remaining
**member**. The thread gets `member_left` then `owner_transferred`, and everybody
gets `talk.member.role_changed` naming the heir. `successorOf()` works the heir
out client-side with the same rule so the confirm dialog can NAME them. **The
last member out leaves the group owner-less** — allowed, not an error, and
nothing can rename or disband it afterwards. So never assume a group has an
`owner` in its member list.

Leaving KEEPS the row, frozen at the moment you left, and `POST
/talk/chats/delete` is the second step that gets rid of it: it takes direct
chats **and groups you have left** (`self.has_left`), refusing a group you are
still in with a 400 naming the ids. A hidden group never comes back — nothing
sent after you left is yours to be told about — where a hidden direct chat
returns on the next message. `canHideChat()` in `features/chat/lib/chat-labels.ts`
is the only place that decides which rows a delete may name.

`talk.member.role_changed` covers all three cases in one event;
`previous_member_role` tells them apart and `member_role: 'owner'` means
succession (where `by_*` is the person who LEFT, not a promoter). The stream
patches the member list AND — when it names me — `chat.self.member_role` through
`setSelfRole`, which is the field every gate above reads. Without it a promoted
member sees no new controls until they reload.

Three new `system_event` codes ride along: `member_promoted`, `member_demoted`,
`owner_transferred`, rendered from the operands in `lib/system-messages.ts` and
falling back to the server's `body` as always.

### Three pin features, and no two share storage or audience

- **Pin the CHAT in my list** — `PUT /talk/chats/{id}/pin`, private, `chat-list-store`.
- **Pin a MESSAGE for EVERYONE** — `for_everyone: true` (the server's DEFAULT).
  The announcement bar, the same for every reader: `message.is_pinned`.
- **Pin a MESSAGE for ME** — `for_everyone: false`. A private bookmark:
  `message.is_pinned_for_me`, nobody else's view changes and nobody is notified.

The flag is sent EXPLICITLY in both directions, because omitting it pins for the
whole chat. `GET /talk/chats/{id}/pins` takes `scope` (`everyone` | `me` | `all`)
and `usePins` reads `all`, so a message pinned both ways is TWO rows with two
pinners and two expiries — keyed on `pinKey()`, never on the message id alone.
`PinnedBar` draws the chat-wide pins ONLY; the sheet holds both and labels the
private ones. The private pin needs only MEMBERSHIP, so it works in a group you
left or are muted in. Its two socket events, `talk.message.self_pinned` /
`self_unpinned`, go to MY OTHER DEVICES and never to the room — no actor to
compare, so they always bump the pin list.

### A group's history starts where YOU joined

A member added later is served nothing written before they joined — filtered in
the database on every path: thread, `before_id` paging, the inline `reply_to`
quote, search, the gallery, both pin lists, the preview and the unread count.
Removed and re-added starts again from the RE-ADD. So an empty first page is a
correct answer for a fresh member (render the empty thread, not a spinner), an
empty older page means "this is the start", and a `reply_to` can be null for a
reason other than deletion. Direct chats are unaffected.

### Arriving in a chat, and the inbox tick

`talk.chat.created` is the ONE event for both arrivals — a chat created with me
in it, and me being ADDED to a group that already existed, told apart by
`added_by_talk_user_id`. Both carry the whole row from my side and the server
admits my sockets to the room in the same call, so the row is inserted and no
read is needed; `talk.member.added` still goes to the ROOM, which is exactly
where the added person is not. The envelope's `type` is the event name and the
chat's kind is `chat_type` — never read the kind off `type`.

Rooms for chats that ALREADY existed are still the client's job: every row of
`GET /talk/chats` must be joined, including the pages past the first, which is
why `useChats` walks the list to `CHAT_LIST_MAX_PAGES` rather than stopping at
thirty. A row that is listed but never joined is a chat that only updates on
reload.

`last_message_is_read_by_all` puts the sender's blue tick on the inbox row, and
`talk.message.read` keeps it live between reads. That event now carries
`receipts` — but they are the READER'S OWN rows, so in a group one event means
one more person, not everyone: `applyRead` counts distinct readers against the
member count instead of flipping the tick on the first one. The message-info
sheet still re-reads the endpoint, because it lists people who have NOT read and
the event cannot name them.

### The direct-chat block is a WINDOW, not a wall

A blocked person's sends now SUCCEED — stored, receipted, answered 200 — so
NOTHING may infer "you are blocked" from a send result. Only the other direction
refuses: a 403 when *I* blocked *them*, which names itself. Creating a direct
chat with somebody who blocked me succeeds too.

The block is an interval `[blocked_at, unblocked_at)` and unblocking hands back
NOTHING: messages written while it stood stay hidden from the blocker for good,
everywhere — thread, search, gallery, pins, preview, unread. So there is no gap
marker, no placeholder for a suppressed message, and no "load what I missed" to
build; `personBlockCopy` says so before the user decides. While it stands the
blocker receives no `talk.message.*` for that chat (an edit to a PRE-block
message included, so their copy can be stale until the next read), and no
`talk.chat.created` — that chat turns up as an empty direct thread instead, which
must render without error. `talk:typing` and read receipts are NOT suppressed.
This is all the DIRECT block; the group owner's block is untouched.

### The chat row is per VIEWER, and `last_message_at` can be null

`lastMessageAt` / `lastMessagePreview` / `lastMessageSender*` always describe the
SAME message — the newest one *I* can still see. It is **null** on a chat I
cleared with nothing newer, and on one nobody has spoken in, so `reorder()` in
`chat-list-store` sorts those LAST rather than borrowing `createdAt`.
`unread_count` excludes block-hidden messages, and `GET /talk/unread` is now
literally the sum of the rows. `upto_message_id` is clamped to the named chat —
still send an id that belongs to it, and omit it entirely for "mark all read",
since one id applies to every chat in the call.

### Opening a conversation is ONE round trip

`talk:join { chat_id, with_chat: true }` acks `{ ok, chat }` — the same body
`GET /talk/chats/{id}` answers — so `joinAndReadChat()` in `chat-api.ts` is how
`useChat` and a freshly created chat subscribe and render at once. Three ways it
comes back short (no socket, `ok: false`, no `chat` key) and all three fall back
to the HTTP read, then re-join. The RECONNECT re-join must stay the pure key
lookup it is — never `with_chat` there. `talk.chat.created` now carries the whole
row from the RECIPIENT'S side, so it is inserted straight in; `adoptChat` is only
the fallback for the null-`chat` race. A creator needs no read-back at all: the
grant is issued at creation.

### Push is the same events, delivered twice

Every Talk event that reaches the socket ALSO reaches the browser as an FCM
push, carrying **the same object**. So there is no second set of handlers: a
push is parsed once and run through the handlers `use-message-stream.ts` already
binds to the socket.

What makes that safe is **not** suppressing every repeat.
`lib/talk-event-dedupe.ts` guards exactly two events — `talk.message.new` (keyed
on the message id) and `talk.chat.created` (on the chat id) — because only those
two are non-idempotent AND carry an identity that is minted once: one increments
an unread count, the other inserts a row and joins a room. **Everything else is
applied every time it arrives.** An edit writes the same body, a delete sets the
same tombstone, a receipt re-adds a reader already in the set — all harmless
twice — while the pins and the roles TOGGLE, and pin → unpin → pin is three real
events whose first and third are indistinguishable. Suppress on type and id and
the third one vanishes, so the message quietly stops being pinned. Never key on
FCM's own message id: it differs from the socket's every time.

FCM flattens `data` to a STRING map (`data.chat_id` is `"7"`), which is why only
`data.payload` is read — the whole event as one JSON string, byte-identical to
the socket frame. `lib/push-payload.ts` is the only place that parses it.

**Loud or silent is decided by `notification.body`, never by a list of event
names.** Loud: `talk.message.new` (membership sentences included — they are
system messages), `talk.chat.created`, `talk.message.pinned`. Everything else is
data-only and exists so a backgrounded client stays correct without buzzing.
`talk.typing.*` is never pushed. An event the socket handlers do not know
(`talk.unread.updated`, or anything added later) is treated as a NUDGE to
re-read: REST is the source of truth and both delivery paths are best-effort.

`POST /talk/devices` is an UPSERT and is how the server knows the browser is
still alive — it is called on every launch, after every login and on every token
rotation, and a cached "already registered" must never skip it. `platform` is
the same slot the login claimed (`WEB`): it is a SLOT, not a label, so saving a
token retires whatever token held it. A normal `POST /talk/auth/logout` already
drops this platform's registration, so `DELETE /talk/devices` is only for
clearing local state without hitting that route.

`public/firebase-messaging-sw.js` is a static asset and cannot import from
`src/` — its Firebase config is handed to it in the REGISTRATION QUERY STRING so
those values live only in `.env`, and the two message names it shares with the
page are duplicated in `features/notifications/constants.ts`. It never routes a
tap itself: a record id never goes in a path here, so it opens `/chat`, posts
the event to the page, and `use-push-open-chat.ts` sets the active chat, which
is what writes the encrypted `?data=` token.

The whole subsystem is dormant until `VITE_APP_FIREBASE_CONFIG` — the console's
web-app config object as ONE line of JSON, parsed in `config/env.ts` — and
`VITE_APP_FIREBASE_VAPID_KEY` are both filled in. `isPushConfigured()` is
all-or-nothing across every field of that object, and the SDK itself is
dynamically imported so an unconfigured build never loads it.

### Things the API cannot do, so the UI does not offer them

- **Reaching outside your grants.** `GET /talk/contacts` lists only the companies
  and departments an administrator granted you, so `PeoplePicker` has nothing to
  offer a person with no grants — the empty state says to ask an administrator
  rather than implying a broken read. The type-an-id escape hatch is gone: the
  directory replaced it, and the server drops ungranted ids anyway.
- **Jumping to an old search hit.** History pages by id from the newest end, so
  `MessageSearchDialog` opens the hit's conversation instead of scrolling to it.
- **Retrying a failed attachment.** The `File` does not survive a reload, so a
  failed media send asks for the file again; a failed text send replays as-is.
- **Telling who blocked me.** Nothing fails and no event fires, by design — the
  old 403 on a send was a reliable probe and it is gone.
- **Re-asking for notification permission.** A `denied` answer is final — the
  browser will not show the prompt again from script — so the offer is shown for
  `prompt` only, and a "not now" is remembered in `ui-store`.
- **Reading what arrived while I had somebody blocked.** It is hidden for good;
  an "unblock to catch up" affordance would promise something that cannot happen.

## Non-negotiable rules

1. **Server data → the feature's `api/` hooks. Client/UI state → Zustand.**
   There are exactly **three** deliberate overlaps, all because the socket has to
   read or mutate them and a list held in a hook's `useState` is unreachable from
   an event handler: `stores/message-cache-store.ts` (in-memory ONLY — never
   persisted; a reload re-reads from the API),
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
    an echo of **your own** sends, which is why the cache merges by `id` — and why
    it lands an echo of a send STILL IN FLIGHT on that send's optimistic bubble.
    `client_message_id` goes up with a send and is never echoed back, so a
    pending row is matched on its sender, text and attachment count instead
    (`adopt` in `stores/message-cache-store.ts`). Without it the sender watches
    their own message appear twice until the HTTP response collapses it.
    Four more rules that are load-bearing and easy to lose:
    - **Fetch, then `talk:join`.** A join with no preceding read is refused; the
      read is what issues the Redis grant. Rooms do **not** survive a reconnect.
    - **Re-join on every `connected`**, first connect included. Skipping it looks
      exactly like a healthy socket that delivers nothing.
    - **Push every rotated token to the socket** (`updateSocketToken`). It emits
      `talk:auth.token`, which swaps the bearer **in place** — no reconnect, so
      no lost rooms — and sets `socket.auth` so the next handshake uses it too.
      Skip it and the socket goes on reporting connected while every write it
      makes fails 401 from the half-hour onwards.
    - **Writes go over the socket when it is live, HTTP when it is not.** Every
      write is bridged: the gateway holds no database, so `talk:message.send` is
      `POST /talk/chats/:id/messages` one hop away, called with our own bearer,
      and the ack carries that route's status and body verbatim. `write()` in
      `chat-api.ts` picks the transport; `socketCall()` owns the ack contract and
      the single 401 refresh-and-replay. A refusal the route issued (403/404/409)
      is thrown as-is — only a TRANSPORT failure retries over HTTP.
      Reads, presigns, hide-chat, the private block and chat-pin stay HTTP only.
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
22. **Firebase is only imported in `lib/firebase-messaging.ts`**, and only
    dynamically — a build with no Firebase config must not carry the SDK. A push
    is never handled on its own: it is parsed in
    `features/notifications/lib/push-payload.ts`, published on the push bus, and
    applied by the SOCKET handler for the same event, once `admitTalkEvent` has
    ruled out the copy that already arrived the other way.

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
│   ├── chat/         conversation list, thread, composer, realtime stream
│   └── notifications/  FCM device registry, push delivery, permission prompt
├── components/     ui/ (shadcn), common/ (shared app pieces)
├── lib/            api-client, api-error, api-toast, auth-refresh, socket-client,
│                   firebase-messaging, uploads, platform, cookie, crypto,
│                   idb-storage, endpoints, config-api/-mappers, logger, utils,
│                   validation
├── stores/         GLOBAL zustand: auth, chat, chat-list, message-cache,
│                   talk-directory, config, media-viewer, ui
├── hooks/          app-wide: use-app-config, use-debounced-value, use-is-mobile,
│                   use-online-status
├── config/         env.ts (zod), api-proxy.ts
├── types/          api.ts (Id, ListPage, MessagePage), config.ts
└── styles/         globals.css — the design tokens

public/
└── firebase-messaging-sw.js   the push service worker (static, no src/ imports)
```

## Where a new file goes

| You're adding | It goes in |
|---|---|
| A new screen (e.g. group settings) | `features/<feature>/pages/<feature>-<kind>-page.tsx` + a route in `routes/app-routes.tsx` |
| A new endpoint call | path in `lib/endpoints.ts`, function in `features/<f>/api/<f>-api.ts`, hook in `features/<f>/api/use-<thing>.ts` |
| A DTO → UI mapping | `features/<f>/lib/<f>-mappers.ts` |
| A date/text formatter | `features/<f>/lib/message-formatters.ts` (chat) or `lib/utils.ts` (app-wide) |
| Screen state / a submit handler | `features/<f>/hooks/use-<thing>-*.ts` — **not** in the component |
| A new inbound socket event (a write) | name in `SOCKET_ACTIONS` (`features/chat/constants.ts`), call through `write()` in `chat-api.ts` |
| A new outbound socket event | name in `SOCKET_EVENTS` (`features/chat/constants.ts`), handler in `use-message-stream.ts` |
| A way to label a person | `features/chat/lib/talk-directory.ts` — nowhere else |
| A check on what a role may do | `features/chat/lib/member-roles.ts` — never `=== 'owner'` at a call site |
| A name for an id with no name in the payload | `stores/talk-directory-store.ts` (typing and presence only) |
| A file upload | a presign path in `lib/endpoints.ts`, then `uploadFile` from `lib/uploads.ts` |
| A dialog | `Modal` from `components/common/modal.tsx` |
| A shadcn primitive | `npx shadcn@latest add <name>` → `components/ui/` (don't hand-write) |
| A shared app component | `components/common/` |
| A component used by one feature | `features/<f>/components/` |
| A new global store | `stores/<name>-store.ts` + `main.tsx` rehydrate list if persisted |
| Anything touching the Firebase SDK | `lib/firebase-messaging.ts` — nowhere else, exactly like socket.io |
| Handling a NEW pushed event | nothing, if the socket already handles it — the bridge in `use-message-stream.ts` runs the same handler |
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
- No `firebase` import outside `lib/firebase-messaging.ts`.
- A new pushed event is handled by the SOCKET handler, through the bridge — not
  by a second handler that will drift from it.
- A new `*_url` field from the API is rendered through `useMediaUrl()`, not raw.
- A new `photo` field is treated the same way — it is a storage key, not a URL.
- A new read that carries `name`/`photo` calls `rememberPeople` in its
  `features/chat/api/` function, so typing and presence keep resolving names.
- If you touched the socket or the token flow, re-read §9 of
  `TALK-IMPLEMENTATION.md` and check all eleven client responsibilities still hold.
