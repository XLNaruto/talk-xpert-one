# XpertOne Talk — Client Integration Guide

Everything a **mobile client** (Android / iOS / desktop) needs to build against
the Talk API: the feature set, the REST contract, the realtime socket contract,
push notifications, uploads, and the client-side rules that make it behave.

Platform-agnostic. Nothing here assumes a particular UI framework.

- **OpenAPI document:** `GET /talk/docs`
- **Base URL:** `<api origin>` — every Talk route is under `/talk`, except the
  public bootstrap read `GET /config`.
- **Auth:** `Authorization: Bearer <access token>` on everything except
  `GET /config` and `POST /talk/auth/login`.

---

## Table of contents

1. [What Talk is](#1-what-talk-is)
2. [Concepts and glossary](#2-concepts-and-glossary)
3. [Bootstrap: `GET /config`](#3-bootstrap-get-config)
4. [Authentication and sessions](#4-authentication-and-sessions)
5. [REST API reference](#5-rest-api-reference)
6. [Data models](#6-data-models)
7. [Socket contract](#7-socket-contract)
8. [File uploads](#8-file-uploads)
9. [Push notifications](#9-push-notifications)
10. [Feature behaviour guide](#10-feature-behaviour-guide)
11. [Client responsibilities checklist](#11-client-responsibilities-checklist)
12. [Errors](#12-errors)
13. [Constants and tuning values](#13-constants-and-tuning-values)
14. [Things the API cannot do](#14-things-the-api-cannot-do)

---

## 1. What Talk is

A realtime chat product inside XpertOne. The feature set a full client covers:

| Area | What it includes |
|---|---|
| **Auth** | email + password + mandatory `platform`, rotating refresh tokens, one live session per OS |
| **Directory** | `GET /talk/contacts` — everyone an administrator granted me reach to |
| **Chats** | direct (1:1, idempotent) and groups; inbox with search, filters, pin, hide, unread |
| **Thread** | history paging by message id, replies with inline quotes, edit, delete (for me / for everyone), forward, in-thread search |
| **Attachments** | direct-to-storage presigned uploads, up to 25 MB, 10 per message; per-chat media gallery |
| **Groups** | create, rename, avatar, description, add/remove members, roles (owner/admin/member), mute a member, leave, disband |
| **Pins** | three separate features: pin the chat in my list, pin a message for everyone, pin a message for me |
| **Blocks** | my private direct-chat block, and the group owner's "muted" block |
| **Presence & typing** | online/last-seen broadcast, typing indicators |
| **Receipts** | delivered/read per message, blue tick, message-info sheet |
| **Realtime** | one socket, bridged writes, room joins, reconnect catch-up |
| **Push** | FCM device registry; every socket event also arrives as a push |

---

## 2. Concepts and glossary

| Term | Meaning |
|---|---|
| **talk_user_id** | A person's Talk identity. Everything person-shaped uses this — never a master-record employee id. |
| **account_id** | The tenant. One person belongs to exactly one account. |
| **chat** | A conversation. `type` is `direct` (two people) or `group` (many). |
| **direct chat** | Two people. Has no `name` of its own — it is titled by `counterpart_name` / `counterpart_photo`. Idempotent to create. |
| **group** | Named, avatar'd, has an owner, admins and members. |
| **member_role** | `owner` \| `admin` \| `member`. |
| **system message** | A message with `sender_talk_user_id: null` that narrates an event ("Minato added Goku"). |
| **storage key** | Every `*_url` and every `photo` the API returns is a KEY, not a URL. Prefix with `media_path` from `GET /config`. |
| **platform** | The session/device SLOT: `WEB` \| `ANDROID` \| `IOS` \| `MAC` \| `WINDOWS` \| `LINUX`. One live session and one live push device per slot. |
| **grant** | A short-lived server-side permission recorded by a REST read; it is what lets `talk:join` succeed. |
| **client_message_id** | A UUID the client mints per send. Makes the send idempotent and reconciles the optimistic bubble. |

### The two paging shapes

Everything except messages pages by **offset**:

```jsonc
// ?limit=30&offset=60
{ "items": [ /* … */ ], "total": 128 }
```

**Messages page by message id**, because new rows arrive constantly and an
offset would skip or repeat between requests:

```jsonc
// ?limit=500&before_id=9142      → items come back NEWEST FIRST
{ "items": [ /* … */ ] }
```

- `before_id` — walk UP through history (the only paging direction in the UI).
- `after_id` — replay the gap after a reconnect.
- Never send both.

### There is no response envelope

A list answers `{ items, total }`; a single record answers **itself** at the top
level. There is no `{ data }` to unwrap. Errors are `{ code, message, details? }`.

### Everything person-shaped carries a name and a photo

Every person field carries `name` and `photo` **beside** its integer id:
`sender_*`, the inline `reply_to`'s `sender_*`, `counterpart_*`, `created_by_*`,
`last_message_sender_*`, `blocked_by_*`, `pinned_by_*`, `by_*`, and a plain
`name`/`photo` pair on a member, a receipt, a presence row and a block.

So a screen draws a person from the payload it already holds — no second lookup.

- `name` is **null** when the master record is gone. Fall back to something like
  `Member 42`, decided in ONE place in your codebase.
- **`photo` is a storage KEY**, not a URL — prefix it with `media_path`.

**Only two events do not carry a name:** `talk.typing.*`
(`{ chat_id, talk_user_id }`) and `talk.presence`
(`{ talk_user_id, is_online, at }`). Keep a small **id → name + photo cache**,
fed by every REST read on the way past, and look those two up in it.

---

## 3. Bootstrap: `GET /config`

**No auth. Mounted at the ROOT, not under `/talk`.** Read it at launch, before
signing in, and cache the last known copy.

```jsonc
{
  "media_path":    "https://cdn.example.com/talk/",  // prefix for EVERY storage key
  "realtime_url":  "https://rt.example.com",         // "" = no realtime service
  "realtime_path": "/socket.io"
}
```

- `media_path` is what turns a `photo` / `file_url` / `avatar_url` key into
  something you can load. Build one `mediaUrl(key)` helper and use it everywhere.
- `realtime_url` and `realtime_path` are where to dial the socket. They live on
  the server, not compiled into the client, because they differ per environment.
- **`realtime_url: ""` means this deployment has no realtime service.** Do not
  dial a broken host — send writes over HTTP and poll instead.
- A failed read must never block the app: keep the previous values.

---

## 4. Authentication and sessions

### 4.1 Sign in

```http
POST /talk/auth/login
Content-Type: application/json

{ "email": "asha@acme.com", "password": "…", "platform": "ANDROID" }
```

```jsonc
200 {
  "access_token":  "…",
  "refresh_token": "…",
  "expires_in":    1800,               // seconds — 30 minutes today
  "token_type":    "Bearer",
  "talk_user_id":  42,
  "account_id":    7,
  "platform":      "ANDROID",
  "name":          "Asha Rao",         // nullable
  "photo":         "avatars/42.jpg"    // storage KEY, nullable
}
```

> **`platform` is mandatory and has no default.**
> Talk allows **one live session per operating system**. Send the slot your app
> actually occupies — `ANDROID`, `IOS`, `MAC`, `WINDOWS`, `LINUX`, `WEB`
> (uppercase, exact). A phone claiming `MAC` would silently retire the user's
> signed-in desktop app. Use the **same string** for `POST /talk/devices`.

The login response does **not** echo `email` — keep what the user typed.

### 4.2 Refresh

```http
POST /talk/auth/refresh
{ "refresh_token": "…" }
→ { "access_token": "…", "refresh_token": "…", "expires_in": 1800 }
```

- The refresh token **rotates**: the one you sent is dead the moment this
  answers. **Persist the new pair before replaying anything.**
- Refresh does **not** take a `platform` — it is read from the token, so a
  refresh can never move a session between slots.
- **One refresh in flight, ever.** Make it single-flight: five concurrent 401s
  must cost exactly one refresh call, or four replays of a spent token sign the
  user out for nothing. Everyone else queues behind the same promise/future.
- Never send the refresh token to any other route.

### 4.3 The 401 / 403 rule

- **A 401 buys exactly one refresh-and-replay.** A second 401 on the same
  request is real — sign out.
- **A 403 stops.** It means suspended, or blocked from posting. Refreshing
  cannot help, and showing a login form on a suspended account is a sign-out
  loop.
  - A 403 on a **read** is the suspended case (reads cannot be refused for
    posting reasons) → end the session.
  - A 403 on a **write** is a posting refusal → surface it in the thread and
    leave the session alone.

### 4.4 Keeping the token alive

Renew **ahead of expiry** — check about once a minute and refresh ~2 minutes
before `expires_in` runs out. The reactive 401 path alone is not enough,
because the **socket** holds whichever token it handshook with and dies silently
at the half-hour with no request to hang a retry on.

**After every rotation, push the new token to the live socket** by emitting
`talk:auth.token` (see §7.3). It swaps the bearer **in place** — no reconnect,
so no lost rooms. Skip it and the socket goes on reporting connected while every
write it makes fails 401 from the half-hour onwards.

### 4.5 Other auth routes

| Route | Body / result |
|---|---|
| `GET /talk/me` | `{ talk_user_id, account_id, email, platform, name, photo }` |
| `GET /talk/auth/sessions` | `{ "platforms": ["WEB","ANDROID"] }` — which OS slots hold a live session |
| `POST /talk/auth/logout` | `{ "all_devices": false }`. False ends only THIS platform's session; true clears every platform (a lost device). **Idempotent** — a dead token is not an error, so clear local state regardless of the answer. It also drops this platform's **push-device** registration. |

### 4.6 Why a session ends

Distinguish the two, because the message differs:

- **session lost** — someone signed in on another device of the same OS, or the
  refresh failed. *"You were signed out — this account signed in on another device."*
- **suspended** — a 403 on a read. *"Your Talk access is suspended. Ask your
  administrator to restore it."*

---

## 5. REST API reference

All routes below are under `/talk` and require the bearer token.

### 5.1 Directory

#### `GET /talk/contacts` — everyone I may start a chat with

| Param | Type | Notes |
|---|---|---|
| `search` | string | Case-insensitive partial match on the **name AND the Talk login**. Server-side — never filter the loaded page. |
| `company_id` | int | |
| `department_id` | int | Employees only; a back-office user has no department. |
| `limit` | int | default 30, max 100 |
| `offset` | int | |

```jsonc
{ "items": [{
    "talk_user_id": 51, "name": "Draco Employee", "photo": "avatars/51.jpg",
    "email": "draco@acme.com", "is_employee": true,
    "company_id": 3, "company_name": "Acme Ltd",
    "department_id": 9, "department_name": "Sales",
    "designation_name": "Executive",
    "existing_chat_id": 18          // my current direct chat with them, or null
  }], "total": 240 }
```

- Alphabetical, and **read live per request** — a narrowed grant takes effect at
  once.
- Reach is **granted, never assumed**: an empty list is a real answer (no
  grants), not a failed read. The empty state should say *"ask an
  administrator"*, not imply something broke.
- `existing_chat_id` lets you open the conversation without asking the server.
- Presence is deliberately absent (it moves far faster than this list) — take
  the ids to `GET /talk/presence`.
- Excluded automatically: myself, suspended credentials, deleted master records,
  and **either direction of a block**.

### 5.2 Chats

#### `GET /talk/chats` — the inbox

| Param | Type | Notes |
|---|---|---|
| `search` | string | Matches a group on its name **and** a direct chat on the other person's name. Server-side only — the second cannot be done against the response. |
| `type` | `direct` \| `group` | |
| `pinned_only` | bool | |
| `unread_only` | bool | |
| `limit` | int | default 30, max 100 |
| `offset` | int | |

Returns `{ items: Chat[], total }`, **already ordered** — pinned first, then
newest. Do not re-sort.

Reading this also refreshes the socket **grants** for every row, which is what
makes `talk:join` succeed afterwards.

> **Every listed row must be `talk:join`ed**, including rows past the first page.
> Walk the list (the reference client walks up to 10 pages) rather than stopping
> at 30. A row that is listed but never joined only updates on reload.

#### `GET /talk/chats/{id}` — one chat's header

The same shape as a list row, so the two can never disagree.

#### `POST /talk/chats/direct`

```jsonc
{ "talk_user_id": 51 }  →  { "chat_id": 18, "created": false }
```

**Idempotent** — opening the same direct chat twice returns the same id, so
tapping a contact never has to know whether it is the first time. Creating a
direct chat with somebody who has blocked me **succeeds**.

#### `POST /talk/chats/group`

```jsonc
{ "name": "Q3 launch", "talk_user_ids": [51, 62],
  "description": "…", "avatar_url": "avatars/g/…", "company_id": 3 }
→ { "chat_id": 41 }
```

Ids that are not Talk identities of this account, or that you have no grant for,
are silently dropped. The **creator** needs no read-back before joining the
room — the grant is issued at creation.

#### `PATCH /talk/chats/{id}` — rename / re-describe / re-picture

**Owner only, groups only.** Body: any of `name`, `description`, `avatar_url`.

#### `DELETE /talk/chats/{id}` — disband

**Owner only.** Destroys the group for everyone. The only such deletion in Talk.

#### `POST /talk/chats/delete` — hide from MY list

```jsonc
{ "chat_ids": [18, 22] }
```

Takes **direct chats, and groups I have already LEFT** (`self.has_left`). A
group I am still in is refused with a **400 naming the offending ids** — filter
those out before calling.

- A hidden **direct** chat comes back on the next message.
- A hidden **group** never comes back — nothing sent after you left is yours to
  be told about.

#### `POST /talk/chats/read` — mark read

```jsonc
{ "chat_ids": [18, 22], "upto_message_id": 9142 }   // upto is optional
```

Clears my badge **and** turns the senders' ticks blue. Without `upto_message_id`
it means each chat's newest message — the only correct form for a bulk
"mark all read", because one id would otherwise apply to every chat in the call.
The server clamps `upto_message_id` to the named chat, but send an id that
actually belongs to it: clamping is a backstop, not a feature.

#### `PUT /talk/chats/{id}/pin` — pin the chat in MY list

```jsonc
{ "pinned": true }
```

Entirely private — nobody else's view changes. **HTTP only**, not bridged to the
socket. This is *not* the same as pinning a message.

#### `POST /talk/chats/{id}/avatar/presign`

See [File uploads](#8-file-uploads). Images only, and **no `size_bytes` field**.

#### `GET /talk/chats/{id}/presence`

Everyone in one chat in a single request, so a client needn't list members and
then ask separately. Returns `{ items: Presence[] }`.

#### `POST /talk/chats/{id}/typing`

```jsonc
{ "typing": true }
```

**HTTP fallback only** — prefer the `talk:typing` socket emit, which is relayed
socket-to-socket and never touches the database.

### 5.3 Members

#### `GET /talk/chats/{id}/members`

```jsonc
{ "items": [{
    "talk_user_id": 51, "name": "Draco", "photo": "avatars/51.jpg",
    "member_role": "admin", "joined_at": "2026-07-02T…",
    "is_blocked": false,
    "blocked_by_talk_user_id": null, "blocked_by_name": null, "blocked_by_photo": null
  }] }
```

#### `POST /talk/chats/{id}/members` — add

```jsonc
{ "talk_user_ids": [62, 63] }
```

Owner or admin.

#### `POST /talk/chats/{id}/leave`

Anyone may leave, **the owner included** — see §10.4.

#### `DELETE /talk/chats/{id}/members/{talk_user_id}` — remove

Owner or admin. Refused against the **owner's** row.

#### `PUT /talk/chats/{id}/members/{talk_user_id}/block` — the GROUP block

```jsonc
{ "blocked": true }
```

Silences posting, keeps reading. **Announced to the group.** Owner or admin.
Deliberately not a removal — their app still shows the chat.

#### `PUT /talk/chats/{id}/members/{talk_user_id}/role`

```jsonc
{ "member_role": "admin" }   // "admin" | "member" ONLY — "owner" is a 422
```

- **Idempotent**: setting a role somebody already holds answers 200, writes
  nothing and announces nothing — so never disable the control after a tap.
- Refuses the **owner's row**, **your own row**, and a **plain-member caller**.
  Gate the control instead of making the request and reporting a toast.
- `owner` moves only by **succession** (§10.4).

### 5.4 Messages

#### `GET /talk/chats/{id}/messages`

| Param | Type | Notes |
|---|---|---|
| `limit` | int | `500` for history paging; **`-1` for the OPENING read** |
| `before_id` | int | walk UP through history |
| `after_id` | int | replay the gap after a reconnect |

Returns `{ items }` **newest first** — reverse it if your list works
oldest-first.

> **The opening read is `limit: -1`, which is not a page size.**
> The server answers the last **twenty read** messages for context plus **every
> unread one**, however many that is (a flat hundred when nothing is unread).
> So the unread divider is always inside the first response, and there is no
> "load newer" direction to build. Afterwards only `before_id` pages, 500 at a
> time.

A **short page proves** you reached the end; a full one only suggests more. The
opening read has no page size to compare against, so it can only tell you
whether there is anything at all — the first "load earlier" settles it.

#### `POST /talk/chats/{id}/messages` — send

```jsonc
{
  "body": "on my way",                     // text, or the caption on a media message
  "reply_to_message_id": 9101,             // optional
  "client_message_id": "3f2b…-uuid",       // REQUIRED — idempotency key
  "media": [{
    "kind": "image",                       // image | video | audio | document
    "file_url": "chat/41/abc.jpg",         // the KEY from the presign, not the bytes
    "file_name": "sunset.jpg",
    "mime_type": "image/jpeg",
    "size_bytes": 184320,
    "width": 1600, "height": 900,
    "duration_seconds": null,
    "thumbnail_url": null
  }]
}
→ the full Message object
```

`client_message_id` makes the request **idempotent**: retrying with the same
value answers the SAME message instead of posting a second bubble. This is the
single most visible bug a chat can have and the server can only prevent it if
you supply the id — treat it as required.

> **Sending to somebody who has BLOCKED me SUCCEEDS** — stored, receipted,
> answered 200. Nothing may infer "you are blocked" from a send result. The only
> refusal left is the other direction: a **403 when *I* blocked *them***.

#### `PATCH /talk/chats/{id}/messages/{message_id}` — edit

```jsonc
{ "body": "on my way (5 min)" }   → the full message
```

**Sender only** — not the owner, whose authority is over membership. On a media
message this edits the **caption**.

#### `POST /talk/chats/{id}/messages/delete`

```jsonc
{ "message_ids": [9142], "for_everyone": false }
```

- **for me** (default) — hides them from me alone, and is deliberately
  **silent**: no event fires, because the other party must never learn you hid
  their message.
- **for everyone** — leaves a **tombstone** (the row survives so replies still
  resolve) and emits `talk.message.deleted`.

#### `PUT /talk/chats/{id}/messages/{message_id}/pin`

```jsonc
{ "pinned": true, "for_everyone": true, "expires_at": "2026-09-01T00:00:00Z" }
```

`for_everyone` **defaults to TRUE server-side** — send it explicitly in both
directions, or a private pin silently pins for the whole chat. Idempotent:
re-pinning is how an expiry is extended.

#### `GET /talk/chats/{id}/pins`

| Param | Notes |
|---|---|
| `scope` | `everyone` (server default) \| `me` \| `all` |
| `limit` / `offset` | default 20, max 100 |

Live, unexpired pins, **newest PIN first** — the order is when somebody decided
a message mattered, not when it was written. **Each row carries the message
itself**, so the pin screen renders in one call.

Under `scope=all` a message pinned **both** ways comes back **twice** — two
rows, two pinners, two expiries. Key on (message_id, for_everyone), never on the
message id alone.

Pins obey MY history exactly as the thread does: a pin whose message I deleted
for myself, or which predates my join, or which was written while I had the
sender blocked, is absent from both `items` and `total` — even for a chat-wide
pin, and even for one I set myself.

#### `GET /talk/chats/{id}/messages/{message_id}/receipts`

**SENDER only** — a non-sender gets a **404**, not a 403, because read state is
the sender's information.

```jsonc
{ "items": [{ "talk_user_id": 51, "name": "Draco", "photo": "…",
              "delivered_at": "…", "read_at": null }] }
```

Still worth re-reading even though `talk.message.read` exists — the event cannot
name the people who have **not** read.

#### `GET /talk/chats/{id}/media` — the gallery

`?kind=image|video|audio|document&limit=40&offset=0`, newest first.
Returns `{ items: MessageMedia[], total }`.

#### `POST /talk/chats/{id}/media/presign`

See [File uploads](#8-file-uploads). Refused for the same reasons a send is —
you left, were removed, were blocked from posting — so resolve those before
showing a file picker.

#### `POST /talk/messages/forward`

```jsonc
{ "message_ids": [9142], "to_chat_ids": [18, 41] }  →  { "forwarded": 2 }
```

A forward is a **new message**, not a pointer — the destination cannot see the
source. Each destination gets its own `talk.message.new`.

#### `GET /talk/messages/search`

`?q=invoice&chat_id=41&limit=30&offset=0` — `chat_id` optional; without it, the
search runs across every chat I am in. Rows are **lean** (id, chat_id, sender,
type, body, created_at), not full messages.

### 5.5 Blocks, presence, unread, devices

#### `PUT /talk/blocks` — my private direct-chat block

```jsonc
{ "talk_user_id": 51, "blocked": true }
```

#### `GET /talk/blocks`

```jsonc
{ "items": [{ "talk_user_id": 51, "name": "…", "photo": "…",
              "blocked_at": "2026-08-01T…" }] }
```

My own list only. **It never reports who has blocked ME** — nothing does.
`blocked_at` is when the **current** episode began, not when the row was first
written: a block is an interval, and re-blocking starts a new one.

#### `GET /talk/presence?talk_user_ids=42,51,62`

```jsonc
{ "items": [{ "talk_user_id": 51, "name": "…", "photo": "…",
              "is_online": true, "last_seen_at": "…" }] }
```

#### `GET /talk/unread`

Literally the sum of the rows' `unread_count`. You generally do not need it:
each chat row carries its own count and the socket keeps it live, so a second
copy of the same number can only ever disagree with the rows it sits above.

#### `GET | POST | DELETE /talk/devices`

See [Push notifications](#9-push-notifications).

---

## 6. Data models

All payloads are snake_case. All timestamps are **ISO 8601 strings**.

### 6.1 Chat

```jsonc
{
  "id": 41,
  "type": "group",                          // direct | group
  "name": "Q3 launch",                      // null on a direct chat
  "description": null,
  "avatar_url": "avatars/g/41.jpg",         // storage KEY; null on a direct chat
  "company_id": 3,
  "created_by_talk_user_id": 42,
  "created_by_name": "Asha Rao",
  "created_by_photo": "avatars/42.jpg",

  // The OTHER participant of a DIRECT chat — its title and avatar. Null on a group.
  "counterpart_talk_user_id": 51,
  "counterpart_name": "Draco Employee",
  "counterpart_photo": "avatars/51.jpg",

  "member_count": 6,
  "unread_count": 3,

  // All of these describe the SAME message: the newest one *I* can still see.
  "last_message_at": "2026-08-26T09:14:03Z",   // NULL is legal — see below
  "last_message_preview": "see you at 4",      // null when it was a file, or a tombstone
  "last_message_sender_talk_user_id": 51,
  "last_message_sender_name": "Draco",
  "last_message_sender_photo": "avatars/51.jpg",
  "last_message_type": "text",                 // so a file row can say Photo / Video / the filename
  "last_message_deleted_for_everyone": false,
  "last_message_is_edited": false,
  "last_message_is_read_by_all": true,         // the SENDER's blue tick on the inbox row
  "last_message_system_event": null,
  "last_message_system_data": null,            // who ACTED, when the preview is a system line

  "self": {
    "member_role": "admin",
    "is_pinned": false,          // pinned to the top of MY list — private
    "last_read_message_id": 9101,
    "has_left": false,
    "is_blocked": false          // blocked by the group owner: reads on, posting off
  },
  "created_at": "2026-07-02T…"
}
```

> **The chat row is per VIEWER.** `last_message_at` / `_preview` / `_sender_*`
> are **null** on a chat I cleared with nothing newer, and on one nobody has
> spoken in. Sort those **last** — do not fall back to `created_at`.
> `unread_count` excludes messages hidden by a block window.
>
> `last_message_is_read_by_all` is always **false** when the preview is somebody
> else's message: read state is the sender's information.
>
> A system message has no sender, so on a system preview the three
> `last_message_sender_*` fields are all null — use `last_message_system_data`
> to draw who acted.

### 6.2 Message

```jsonc
{
  "id": 9142,
  "chat_id": 41,
  "sender_talk_user_id": 51,        // NULL on a system message
  "sender_name": "Draco",
  "sender_photo": "avatars/51.jpg",
  "type": "image",                  // text|image|video|audio|document|system — derived server-side
  "body": "look at this",           // text, or the media caption; the sentence on a system row
  "reply_to_message_id": 9101,
  "reply_to": {                     // inline quote — rendered with NO second request
    "id": 9101,
    "sender_talk_user_id": 42, "sender_name": "Asha", "sender_photo": "…",
    "type": "text", "body": "where?", "is_deleted": false,
    "media": null                   // a summary, so it may carry no media even when the message did
  },
  "forwarded_from_message_id": null,
  "is_forwarded": false,            // true even when the original is gone — hence a flag
  "is_edited": false,
  "edited_at": null,
  "is_deleted_for_everyone": false, // render a tombstone; the row survives so replies resolve
  "system_event": null,
  "system_data": null,
  "media": [ /* MessageMedia[] */ ],
  "is_pinned": false,               // pinned for EVERYONE — the same for every reader
  "is_pinned_for_me": false,        // my private bookmark — differs per reader
  "is_read_by_all": true,           // the blue tick. Always false on someone else's message
  "read_count": 5,                  // 0 on someone else's message
  "created_at": "2026-08-26T09:14:03Z"
}
```

`reply_to.body` is **null** once the quoted message was deleted for everyone —
and on a group message written **before I joined**, which the server does not
serve me. So a null quote is not always a deletion.

Fields a client typically adds locally and the server never sends: send status
(`sending` / `sent` / `read` / `failed`), the `client_message_id` the bubble was
sent with, upload progress, a failure reason, whether a retry could help, and
the set of reader ids collected from `talk.message.read`.

### 6.3 MessageMedia

```jsonc
{ "id": 88, "kind": "image",
  "file_url": "chat/41/abc.jpg",     // a KEY, despite the name
  "file_name": "sunset.jpg", "mime_type": "image/jpeg", "size_bytes": 184320,
  "width": 1600, "height": 900, "duration_seconds": null,
  "thumbnail_url": null, "position": 0 }
```

### 6.4 System messages

A `system` row has `sender_talk_user_id: null` — it belongs to the
conversation, not to a person. It carries **both**:

- `body` — a **ready-to-render sentence** ("Minato created the group and added
  Draco Employee").
- `system_data` — the **operands** that sentence was rendered from.

```jsonc
"system_event": "member_added",
"system_data": {
  "by_talk_user_id": 42, "by_name": "Minato", "by_photo": "avatars/42.jpg",
  "members": [{ "talk_user_id": 51, "name": "Draco", "photo": "…" }],
  "from": null, "to": null            // the old / new name on group_renamed
}
```

Names and photos inside `system_data` are the ones each person had **at the
time**, so an old line still reads correctly after somebody is renamed or leaves.

**Render from the operands** for the codes you know — only the client knows who
is reading and can write "**You** added Draco". An **unrecognised code must fall
through to the server's `body`**, never onto a guessed event. Feed the names in
`system_data` into your id → name cache, so typing and presence still resolve.

Known codes:

| Code | Extras |
|---|---|
| `group_created` | `members[]` = the first members |
| `group_renamed` | `from`, `to` |
| `member_added` | `members[]` |
| `member_removed` | `members[]` |
| `member_left` | flat `talk_user_id` / `name` / `photo` — the actor and the subject are the same person |
| `member_promoted` | `members[]` |
| `member_demoted` | `members[]` |
| `owner_transferred` | `by_*` is the person who **LEFT**; `members[0]` is the heir |

### 6.5 Enumerations

```
chat.type        direct | group
member_role      owner | admin | member
message.type     text | image | video | audio | document | system   (server-derived)
media.kind       image | video | audio | document
pin scope        everyone | me | all
platform         WEB | ANDROID | IOS | MAC | WINDOWS | LINUX
```

---

## 7. Socket contract

Transport: **Socket.IO**, dialled at `realtime_url` + `realtime_path` from
`GET /config`.

```jsonc
// handshake options
{
  "path": "<realtime_path>",
  "transports": ["websocket"],
  "reconnection": true,
  "reconnectionDelay": 1000,
  "reconnectionDelayMax": 30000,
  "auth": { "token": "<ACCESS token>" }    // NOT the refresh token
}
```

**The naming tells you the direction:**

- **`talk:` with a colon** — imperative — what the client **SENDS**.
- **`talk.` with a dot** — past participle — what the client **RECEIVES**.

### 7.1 Connection lifecycle

| Event | Meaning |
|---|---|
| `connect` | The transport is up. **Not enough.** |
| `connected` | The gateway **accepted the token**: `{ scope, subject_id, account_id }`, where `subject_id` is your own `talk_user_id`. Everything hangs off this. |
| `connect_error` | Handshake refused. If the message says unauthorized, refresh the token and reconnect. |
| `disconnect` | |

**Use ONE socket for the whole app.** The gateway joins each connection to
`account:<id>` and `talk:<talkUserId>` — events are addressed to the **person**,
not to a screen — so a second socket on the same token lands in the same rooms
and double-handles every event. Have one connection and demultiplex on `chat_id`.

You also receive an **echo of your own sends**. Merge incoming messages by `id`,
and be ready for an echo to arrive while your own send is **still in flight** —
match it against the pending row (see §10.2).

### 7.2 Rooms

```jsonc
emit  "talk:join"   { "chat_id": 41, "with_chat": true }   → ack { ok, chat? }
emit  "talk:leave"  { "chat_id": 41 }                      // no ack, never fails
```

Four load-bearing rules:

1. **Fetch, then join.** A join with no preceding read is refused — the read is
   what issues the grant. `ok: false` means the grant lapsed: re-read the chat
   (that re-issues it) and retry the join once.
2. **Rooms do NOT survive a reconnect.** Keep the set of wanted rooms and
   **re-join on every `connected`, first connect included.** Skipping this looks
   exactly like a healthy socket that delivers nothing.
3. **`with_chat: true` acks `{ ok, chat }`** — the same body `GET
   /talk/chats/{id}` answers, built from your own side. That makes opening a
   conversation **one round trip**. Three ways it comes back short — no socket,
   `ok: false`, no `chat` key — and all three mean the same thing: read over
   HTTP, then re-join. Two exceptions: the **creator** of a chat needs no read
   first, and the **reconnect re-join must never ask for `with_chat`** (a read
   per room turns a reconnect into a stampede).
4. Leaving a room also stops that chat's inbox preview and unread updates, so
   most clients only leave on logout.

### 7.3 Writes go over the socket when it is live, HTTP when it is not

Every write is **bridged**: the gateway holds no database, so `talk:message.send`
is `POST /talk/chats/:id/messages` one hop away, called with your own bearer,
and the ack carries that route's status and body **verbatim**. HTTP is not a
degraded fallback — it is the identical operation.

```jsonc
// the ack, and only this
{ "ok": true,  "status": 201, "data": { /* the route's body, byte for byte */ } }
{ "ok": false, "status": 403, "error": { "code": "…", "message": "…", "details": … } }
```

- **Ack timeout 20 s** (the gateway gives the route 15 s before answering 503).
- **401** → refresh once, emit `talk:auth.token`, replay once. A second 401 throws.
- A refusal the route issued (403 / 404 / 409 …) is surfaced **as-is** —
  replaying it over HTTP would only be told the same thing.
- Only a **transport** failure (no ack, socket dropped) falls back to HTTP.
- Payloads are **one flat snake_case object** — the union of what HTTP puts in
  the path and in the body — and ids must be **real integers**: `{ "chat_id":
  "42" }` is refused with a 400 before the URL is even built.

**Reads, presigns, hide-chat, the private block and the chat pin are HTTP only.**

### 7.4 Outbound (client → server): `talk:`

| Event | Payload | Ack `data` |
|---|---|---|
| `talk:message.send` | `{ chat_id, body?, media?, reply_to_message_id?, client_message_id? }` | the full message |
| `talk:message.edit` | `{ chat_id, message_id, body }` | `{ message_id, edited_at }` |
| `talk:message.delete` | `{ chat_id, message_ids, for_everyone }` | `{ affected }` |
| `talk:message.forward` | `{ message_ids, to_chat_ids }` | `{ forwarded }` |
| `talk:message.read` | `{ chat_ids, upto_message_id? }` | `{ affected }` — takes a LIST, so mark-all is one emit |
| `talk:message.pin` | `{ chat_id, message_id, pinned, expires_at?, for_everyone? }` | `{ pinned }` |
| `talk:chat.create.direct` | `{ talk_user_id }` | `{ chat_id, created }` |
| `talk:chat.create.group` | `{ name, talk_user_ids, description?, avatar_url?, company_id? }` | `{ chat_id }` |
| `talk:chat.update` | `{ chat_id, name?, description?, avatar_url? }` | `{ chat_id }` |
| `talk:chat.delete` | `{ chat_id }` | `{ deleted }` — **disbands** a group, not "hide from my list" |
| `talk:member.add` | `{ chat_id, talk_user_ids }` | `{ added }` |
| `talk:member.leave` | `{ chat_id }` | `{ left }` |
| `talk:member.remove` | `{ chat_id, talk_user_id }` | `{ removed }` |
| `talk:member.block` | `{ chat_id, talk_user_id, blocked }` | `{ blocked }` — the GROUP block |
| `talk:member.role` | `{ chat_id, talk_user_id, member_role }` | `{ member_role }` |
| `talk:join` | `{ chat_id, with_chat? }` | `{ ok, chat? }` |
| `talk:leave` | `{ chat_id }` | — |
| `talk:typing` | `{ chat_id, typing }` | — relayed socket-to-socket, never hits the DB |
| `talk:auth.token` | `{ token }` | `{ ok }` — swaps the bearer **in place**, no reconnect |

On `talk:message.pin`, `pinned` picks the **direction** and `for_everyone` picks
the **audience** — the pair chooses between four inbound events.

### 7.5 Inbound (server → client): `talk.`

Every payload carries `type` (its own event name) and, for anything addressed to
a chat room, `chat_id`.

| Event | Payload |
|---|---|
| `talk.message.new` | `{ chat_id, message }` — the full message object |
| `talk.message.edited` | `{ chat_id, message_id, body, edited_at }` |
| `talk.message.deleted` | `{ chat_id, message_ids }` — delete for EVERYONE only |
| `talk.message.read` | `{ chat_id, message_ids, by_talk_user_id, by_name, by_photo, receipts }` |
| `talk.message.pinned` / `.unpinned` | `{ chat_id, message_id, by_talk_user_id, by_name, by_photo }` |
| `talk.message.self_pinned` / `.self_unpinned` | `{ type, chat_id, message_id, expires_at }` — **my other devices only** |
| `talk.chat.created` | `{ chat_id, chat_type, created_by_*, added_by_*?, chat }` |
| `talk.chat.updated` | `{ chat_id, name, description, avatar_url }` |
| `talk.chat.deleted` | `{ chat_id, by_talk_user_id, by_name, by_photo }` — disbanded; eviction follows |
| `talk.member.added` | `{ chat_id, talk_user_ids, members[], by_* }` — to the ROOM |
| `talk.member.left` | `{ chat_id, talk_user_id, name, photo }` |
| `talk.member.removed` | `{ chat_id, talk_user_id, name, photo, by_* }` — sent **twice** by design |
| `talk.member.blocked` | `{ chat_id, talk_user_id, name, photo, blocked, by_* }` |
| `talk.member.role_changed` | `{ chat_id, talk_user_id, name, photo, member_role, previous_member_role, by_* }` |
| `talk.typing.start` / `.stop` | `{ chat_id, talk_user_id }` — sender excluded server-side |
| `talk.presence` | `{ talk_user_id, is_online, at }` — **no `chat_id`** |

#### The ones with sharp edges

**`talk.message.read`** — `receipts` runs parallel to `message_ids`, one row per
message, and they are the **reader's own** rows. In a group, one event means
"one more person has read this", **not** "everybody has". Count distinct readers
against the member count instead of flipping the tick on the first one.

**`talk.chat.created`** — the ONE event for both arrivals: a chat created with
me in it, and me being **added to a group that already existed**, told apart by
`added_by_talk_user_id`. Both carry the whole row **from my side**
(`self.member_role`, a direct chat's `counterpart_*`, everything), and the
server admits my sockets to the room in the same call — so insert the row
straight in; no read is needed. `chat` may be **null** in the rare race where
the chat was deleted in the same breath; then fall back to the HTTP read.

> The envelope's `type` is the **event name**. The chat's kind is `chat_type`
> (and `chat.type`). **Never read the kind off `type`.**

`talk.member.added` goes to the **ROOM**, which is exactly where the newly added
person is not — they get `talk.chat.created` with `added_by_*` instead.

**`talk.member.removed`** is emitted twice: once to the room and once to the
person being cut off a moment later. Compare `talk_user_id` to your own id
before deciding what it means.

**`talk.member.role_changed`** covers promotion, demotion and succession in one
event. `previous_member_role` tells them apart without a lookup, and
`member_role: "owner"` means **succession** — where `by_*` is the person who
**LEFT**, not a promoter. Patch the member list **and**, when it names me,
`chat.self.member_role` — that is the field every permission gate reads. Without
it a promoted member sees no new controls until they reload.

**`talk.message.self_pinned` / `.self_unpinned`** go to MY OTHER DEVICES and
never to the room. There is no actor to compare against, so always apply them.

**`talk.presence`** is broadcast to the **whole account** — filter it to the
people actually on screen. Presence goes stale after ~70 s without a heartbeat,
so "offline" can lag by up to a minute when a client dies uncleanly.

**`talk.typing.*`** carries **no name** — look the id up in your id → name
cache. Expire the indicator on a ~5 s timer rather than trusting
`talk.typing.stop`: a client that crashes mid-sentence never sends one.

### 7.6 The reconnect catch-up

On **every** `connected` — first connect included:

1. Re-read the chat list (which re-issues the grants).
2. **Re-join every wanted room** — a plain key lookup, no `with_chat`.
3. Replay the open thread's gap: `GET …/messages?after_id=<newest cached id>`.
4. Clear stale typing indicators.

---

## 8. File uploads

Attachments go **direct to storage in three steps**. Bytes never pass through
the API, and nothing is written to the database by the handshake — an abandoned
upload leaves a stray object and no half-saved row.

```
1. POST /talk/chats/{id}/media/presign
   { "content_type": "image/jpeg", "file_name": "sunset.jpg", "size_bytes": 184320 }
   → { "upload_url": "https://…signed…", "key": "chat/41/abc.jpg" }

2. PUT <upload_url>
   Content-Type: image/jpeg          ← byte-identical to what was signed for
   <the bytes>                       ← exact byte count
   NO Authorization header           ← the URL carries its own signature;
                                       storage rejects a request with a bearer

3. POST /talk/chats/{id}/messages
   { "media": [{ "kind": "image", "file_url": "chat/41/abc.jpg", … }] }
```

- **Max 25 MB**, and the size is signed **into** the URL — under-reporting it
  buys nothing, storage rejects a body of any other length.
- Max **10 attachments** per message; each is its own presign + PUT, so report
  progress per file.
- The **avatar** presign (`POST /talk/chats/{id}/avatar/presign`) takes **no
  `size_bytes`** and only `image/jpeg`, `image/png`, `image/webp`. Follow it
  with `PATCH /talk/chats/{id}` carrying the key as `avatar_url`.
- Validate the file's **magic bytes**, not just its extension — a renamed file
  reports a content type the bytes do not match, and the presign signs whatever
  you claim.

Allowed attachment content types (anything a browser would execute — `.html`,
`.svg`, executables — is deliberately absent):

```
image/jpeg  image/png  image/webp  image/gif  image/heic
video/mp4   video/quicktime  video/webm
audio/mpeg  audio/mp4  audio/aac  audio/ogg  audio/wav  audio/webm
application/pdf
application/msword
application/vnd.openxmlformats-officedocument.wordprocessingml.document
application/vnd.ms-excel
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
application/vnd.ms-powerpoint
application/vnd.openxmlformats-officedocument.presentationml.presentation
text/plain  text/csv  application/zip  application/x-rar-compressed
```

### Every `*_url` is a storage KEY

`file_url`, `thumbnail_url`, `avatar_url`, `photo` — none of them are URLs.
Prefix each with `media_path` from `GET /config`. A raw key renders nothing.

---

## 9. Push notifications

**Every Talk event that reaches the socket ALSO reaches the device as an FCM
push, carrying the same object.** So there is no second set of handlers: parse
the push once and run it through the handler you already wrote for that socket
event.

### 9.1 The device registry

```http
POST /talk/devices
Authorization: Bearer <access token>

{ "token": "<fcm registration token>",   // required
  "platform": "ANDROID",                 // required — see below
  "device_name": "Pixel 8",              // optional, support only
  "app_version": "3.4.1" }               // optional

200 → { "id": 41, "platform": "ANDROID", "device_name": "Pixel 8",
        "app_version": "3.4.1", "last_used_at": "…", "created_at": "…" }
```

**When to call it**

- on every app launch, as soon as Firebase hands you a token;
- again on every token rotation (`onTokenRefresh` / `onTokenRefreshed`);
- again after a fresh login — the token belongs to whoever is signed in.

It is an **UPSERT**. Calling it repeatedly with the same token is the normal
path, not an error — it is how the server knows the device is still alive.
**Never cache "already registered" and skip it.**

**`platform` is a SLOT, not a label.** Allowed: `ANDROID` | `IOS` | `MAC` |
`WINDOWS` | `LINUX` | `WEB` (uppercase, exact). Talk keeps one live session and
one live device per operating system: saving an `ANDROID` token retires whatever
token previously held the Android slot and leaves the iPhone, Mac and browser
registrations alone. **Send the same string you sent to
`POST /talk/auth/login`.**

There is no `talk_user_id` in any of these bodies — the bearer names the only
participant a device can belong to.

| Route | Notes |
|---|---|
| `GET /talk/devices` | Lists the handsets, most recently active first. **Never the tokens.** |
| `DELETE /talk/devices` | Takes `{ "token": "…" }` in the **body** → `{ "removed": true }`. Idempotent, and scoped to your own devices. |

**You usually do not need DELETE.** A normal `POST /talk/auth/logout` already
drops this platform's registration. It is for the two cases that skip that
route: local state cleared without a logout, and a token you rotated yourself.

### 9.2 The payload

FCM flattens `data` to a **string map** (`data.chat_id` arrives as `"7"`), which
is why the whole event is carried in **`data.payload`** — one JSON string,
byte-identical to the socket frame. Parse that one field and hand the result to
your existing handlers.

### 9.3 Dedupe — guard exactly two events

A connected client receives every event **twice** (socket + push), within a
second or so of each other. Guard **only**:

- **`talk.message.new`** — keyed on the **message id**
- **`talk.chat.created`** — keyed on the **chat id**

because only those two are non-idempotent **and** carry an identity minted once:
one increments an unread count, the other inserts a row and joins a room.
A ~2 minute TTL is plenty — it only has to outlast the delivery gap.

**Everything else must be applied every time it arrives.** An edit writes the
same body, a delete sets the same tombstone, a receipt re-adds a reader already
in the set — all harmless twice. Meanwhile pins and roles **toggle**, and
pin → unpin → pin is three real events whose first and third are
indistinguishable: suppress on type+id and the third one vanishes, so the
message quietly stops being pinned.

> **Never key on FCM's own message id** — it differs from the socket's every time.

### 9.4 Loud or silent

**Decided by whether `notification.body` is present, never by a list of event
names.**

- **Loud:** `talk.message.new` (membership sentences included — they are system
  messages), `talk.chat.created`, `talk.message.pinned`.
- **Silent (data-only):** everything else. They exist so a backgrounded client
  stays correct without buzzing.
- `talk.typing.*` is never pushed.
- An event your handlers do not know (`talk.unread.updated`, or anything added
  later) is a **NUDGE to re-read**. REST is the source of truth and both
  delivery paths are best-effort.

### 9.5 Handling a tap

A record id never goes in a URL path here. Open the chat screen and set the
active conversation from `chat_id` in the parsed payload — do not build a deep
link that leaks an id.

### 9.6 Permission

A **`denied` answer is final** on most platforms — the OS will not show the
prompt again from code. Offer the permission request only when the status is
still "not asked", and remember a "not now" so you do not nag. Delay the token
request ~1.5 s after sign-in so it does not compete with the chat list read and
the socket handshake for the first paint.

---

## 10. Feature behaviour guide

The rules that are not obvious from the endpoint list.

### 10.1 Opening a conversation

One round trip: `talk:join { chat_id, with_chat: true }` acks the chat row
**and** subscribes you. Then read the thread with `limit: -1` (§5.4), which
returns the last twenty read messages plus every unread one — so the unread
divider is always on screen and there is no "load newer" to build.

Then page **upward only**, with `before_id`, 500 at a time.

### 10.2 Sending: optimistic, idempotent, never silently lost

1. Mint a fresh `client_message_id` (UUID) per send.
2. Paint the bubble immediately with status `sending`.
3. Upload any attachments first (§8), then send with the returned keys.
4. On success, reconcile the optimistic row with the response by `id`.
5. On failure, flip the bubble to **`failed` and keep it visible** so the user
   can retry — never make typed text disappear.
   - A **text** send replays as-is.
   - A **media** send must ask for the file again (the file handle rarely
     survives a process restart).
   - When the **server refused** (a 403 from someone I blocked), do not offer a
     retry that cannot work — state the reason instead.

**The echo problem.** You receive `talk.message.new` for your own sends, and it
can arrive **while the HTTP/socket response is still in flight**.
`client_message_id` is **not echoed back**, so match the echo against a pending
row on **sender + text + attachment count**, and merge by `id` thereafter.
Without that, the sender watches their own message appear twice until the
response collapses it.

### 10.3 Unread, receipts and the blue tick

- Each chat row carries its own `unread_count`; the socket keeps it live. Roll
  the totals up client-side.
- Mark read with `POST /talk/chats/read` (or `talk:message.read`, which takes a
  **list**, so "mark all read" is one call).
- **Let the list settle before sending a read.** A virtualised list reports
  several intermediate ranges while it scrolls to the unread divider, and each
  one looks exactly like the user having read those messages. Marking read off
  the first range clears the frontier the moment the chat opens — the one thing
  the divider exists to prevent. Wait ~600 ms.
- The blue tick on a group message is **the count of distinct readers vs the
  member count**, accumulated from `talk.message.read` — one event is one reader.
- The message-info sheet re-reads `…/receipts`, because the event cannot name
  people who have **not** read.

### 10.4 Groups, roles and authority

**`owner` and `admin` hold exactly the same powers over the MEMBERSHIP** — add,
remove, mute, appoint further admins. The one difference is the **target**:

> **The `owner` row is untouchable** — by an admin, and by the owner on their own
> row. That is what makes appointing an admin a delegation rather than a gamble.

Two powers stay **owner-only**: rename/edit (`PATCH /talk/chats/{id}`) and
disband. So gate your screens on **two** questions, never one:

- `canManageMembers` — owner **or** admin
- `canEditGroup` — owner only

Decide both in **one place** in your codebase. Never `role == "owner"` at a call
site.

**Succession.** The owner may leave, and the group is handed on in the same
operation: the longest-standing remaining **admin**, else the longest-standing
remaining **member**. The thread gets `member_left` then `owner_transferred`,
and everybody gets `talk.member.role_changed` naming the heir. Work the heir out
client-side with the same rule so the confirm dialog can **name** them.

> **The last member out leaves the group owner-less** — allowed, not an error.
> Nothing can rename or disband it afterwards. **Never assume a group has an
> owner in its member list.**

**Leaving keeps the row**, frozen at the moment you left.
`POST /talk/chats/delete` is the second step that gets rid of it.

### 10.5 A group's history starts where YOU joined

A member added later is served **nothing** written before they joined — filtered
in the database on every path: the thread, `before_id` paging, the inline
`reply_to` quote, search, the gallery, both pin lists, the inbox preview and the
unread count. Removed and re-added starts again from the **re-add**.

Consequences to handle:

- An **empty first page is a correct answer** for a fresh member. Render an
  empty thread, not a spinner.
- An empty older page means "this is the start".
- A null `reply_to` can mean "before my time", not only "deleted".

Direct chats are unaffected.

### 10.6 Three pin features, no shared storage or audience

| Feature | Call | Field | Audience |
|---|---|---|---|
| Pin the **chat** in my list | `PUT /talk/chats/{id}/pin` | `self.is_pinned` | private, my list order |
| Pin a **message for everyone** | `for_everyone: true` (the **default**) | `message.is_pinned` | the announcement bar, same for every reader |
| Pin a **message for me** | `for_everyone: false` | `message.is_pinned_for_me` | private bookmark; nobody else's view changes, nobody is notified |

- **Send the flag explicitly in both directions** — omitting it pins for the
  whole chat.
- `GET …/pins?scope=all` returns a doubly-pinned message **twice**. Key on
  (message_id, for_everyone).
- The announcement bar draws **chat-wide pins only**; a combined sheet should
  label the private ones.
- The **private pin needs only membership**, so it works in a group you left or
  are muted in, where the chat-wide pin is refused.

### 10.7 The direct-chat block is a WINDOW, not a wall

- A blocked person's sends **succeed** — stored, receipted, answered 200.
  **Nothing may infer "you are blocked" from a send result.**
- The only refusal is the other direction: **403 when *I* blocked *them***.
- Creating a direct chat with somebody who blocked me **succeeds**.
- The block is an interval `[blocked_at, unblocked_at)`. **Unblocking hands back
  nothing**: messages written while it stood stay hidden from the blocker for
  good — thread, search, gallery, pins, preview, unread. So there is no gap
  marker to draw, no placeholder for a suppressed message, and no "load what I
  missed" to build. Say so **before** the user decides to block.
- While it stands, the blocker receives no `talk.message.*` for that chat (an
  **edit to a pre-block message included**, so their copy can be stale until the
  next read), and no `talk.chat.created` — that chat turns up as an **empty
  direct thread** instead, which must render without error.
- `talk:typing` and read receipts are **not** suppressed.

This is the direct block. The **group** owner's block (`…/members/{id}/block`)
is a different feature: posting off, reading on, announced to the group.

### 10.8 Typing and presence

- Typing is a **socket emit, throttled by the client**: at most one
  `typing: true` every ~3.5 s, **never per keystroke**. Nothing rate-limits it
  server-side.
- Expire the indicator on a ~5 s timer; do not trust `talk.typing.stop`.
- `talk.presence` is account-wide — filter it to the people on screen.
- Presence goes stale after ~70 s, so "offline" can lag by up to a minute.

### 10.9 Search

- **Inbox search** (`GET /talk/chats?search=`) is server-side: it matches a
  group's name **and** a direct chat's counterpart name.
- **Directory search** (`GET /talk/contacts?search=`) is a **request**, never a
  filter over the loaded page — the grant can reach thousands of colleagues.
- **Message search** (`GET /talk/messages/search`) returns lean rows. Because
  history pages by id from the newest end, there is no cheap "jump to this old
  hit" — open the hit's **conversation** instead. An in-thread find bar can walk
  history to reach a hit, but bound how many pages it will pull.

### 10.10 Arriving in a chat

`talk.chat.created` covers both a chat created with me in it and me being added
to an existing group. The row arrives whole and the server has already admitted
my sockets — insert and render, no read needed.

Rooms for chats that **already existed** are still the client's job: join every
row of `GET /talk/chats`, on every page.

Messages can arrive for a chat the client has never listed (one past the inbox
pages, one created while offline, one you had hidden). Read that chat and insert
it — but **cool down after a refused read** (~60 s), or a chat you were removed
from is re-read once per message in it.

---

## 11. Client responsibilities checklist

Work through this before calling a client done.

**Session**

- [ ] `platform` sent on login, correct for the OS, and reused for `POST /talk/devices`.
- [ ] Refresh is **single-flight**; the new pair is persisted before anything replays.
- [ ] 401 → one refresh-and-replay. 403 → stop (read = suspended, write = posting refusal).
- [ ] Token renewed **ahead** of expiry, not only reactively.
- [ ] Every rotated token pushed to the socket via `talk:auth.token`.
- [ ] The refresh token is never sent anywhere but `/talk/auth/refresh`.

**Socket**

- [ ] Exactly **one** connection; handlers bound once.
- [ ] The catch-up runs on **every** `connected`, first connect included.
- [ ] Every listed chat is `talk:join`ed, on every page of the list.
- [ ] Re-join never uses `with_chat`.
- [ ] A refused join triggers a re-read, then one retry.
- [ ] After a reconnect, the open thread replays its gap with `after_id`.
- [ ] Writes prefer the socket and fall back to HTTP **only** on transport failure.

**Messages**

- [ ] A fresh `client_message_id` per send.
- [ ] The socket echo of your own send is matched against the pending row.
- [ ] A failed send stays visible as `failed`, with a retry where a retry can work.
- [ ] The message cache merges by `id`.
- [ ] The opening read uses `limit: -1`; history pages only with `before_id`.
- [ ] Read receipts are sent only after the list has settled.

**Data**

- [ ] Every `*_url` and every `photo` is rendered through the `media_path` prefix.
- [ ] Every read that carries `name` / `photo` feeds the id → name cache.
- [ ] Timestamps stored and passed as ISO strings.
- [ ] Nothing sensitive in plain local storage; credentials encrypted at rest.
- [ ] No record id in a URL path or a deep link.

**Push**

- [ ] `POST /talk/devices` on launch, after login, and on every token rotation.
- [ ] Only `talk.message.new` and `talk.chat.created` are deduped; everything else applies every time.
- [ ] Dedupe never keys on FCM's own message id.
- [ ] Pushed events run through the **same** handlers as the socket.

**Permissions**

- [ ] `canManageMembers` (owner **or** admin) and `canEditGroup` (owner only) are two separate gates, decided in one place.
- [ ] The owner's row is never a target for remove / mute / demote.
- [ ] A group with no owner renders correctly.

---

## 12. Errors

```jsonc
{ "code": "CHAT_NOT_FOUND", "message": "…", "details": { … } }
```

No envelope. A socket ack carries the same object under `error`, with the
route's own HTTP status under `status`.

| Status | Where it shows up | What it means |
|---|---|---|
| **400** | `POST /talk/chats/delete` | You named a group you are still in — the ids are in `details`. |
| **400** | any socket write | An id was sent as a string, or the payload failed schema validation before the URL was built. |
| **401** | anything | Access token expired. One refresh-and-replay. |
| **403** | a **read** | The credential is suspended. End the session. |
| **403** | a **write** | Posting refused: you left, were removed, were muted by the owner, or **you** blocked this person. Surface it in the thread; do not sign out. |
| **404** | `…/messages/{id}/receipts` | You are not the sender. Read state is the sender's information — this is deliberately not a 403. |
| **404** | a chat route | Not a member, or the chat is gone. |
| **422** | `…/members/{id}/role` | `member_role: "owner"` — the role moves only by succession. |
| **503** | a socket ack | The bridged route did not answer within 15 s. |

Error copy should state **what went wrong and how to fix it**, and should not
apologise.

---

## 13. Constants and tuning values

Values the reference client uses. The API caps are hard; the rest are judgement
calls worth copying.

| Constant | Value | What it is |
|---|---|---|
| Opening thread read | `limit: -1` | 20 read + every unread (100 when nothing is unread) |
| History page size | 500 | one `before_id` page |
| Chat page size / max | 30 / 100 | inbox paging; API caps `limit` at 100 |
| Chat list pages walked | 10 | every row must be joined, so the read pages to the end |
| Pin page size / max | 20 / 100 | each row carries a whole message |
| Contact page size / max | 30 / 100 | it is a search box, not a phone book |
| Attachment max size | **25 MB** | server-enforced, signed into the URL |
| Attachments per message | 10 | each is a separate presign + PUT |
| Access token lifetime | 1800 s | renew ~120 s early, check every 60 s |
| Socket ack timeout | 20 s | the bridged route gets 15 s |
| Typing throttle | 3500 ms | never per keystroke |
| Typing expiry | 5000 ms | do not trust `talk.typing.stop` |
| Presence staleness | ~70 s | "offline" can lag by this much |
| Push dedupe TTL / keys | 120 s / 500 | only `message.new` and `chat.created` |
| Read-receipt settle delay | 600 ms | let the list stop scrolling first |
| Failed-read cooldown | 60 s | per chat, before re-attempting an adopt |

---

## 14. Things the API cannot do

Do not build UI that promises these.

- **Reaching outside your grants.** `GET /talk/contacts` lists only the
  companies and departments an administrator granted you. A person with no
  grants has nobody to pick — say "ask an administrator". There is no
  type-an-id escape hatch; the server drops ungranted ids anyway.
- **Jumping to an old search hit.** History pages by id from the newest end.
  Open the hit's conversation instead.
- **Retrying a failed attachment automatically.** The file handle does not
  survive a restart — ask for the file again. A failed text send replays as-is.
- **Telling who blocked me.** Nothing fails and no event fires, by design. The
  old 403 on a send was a reliable probe and it is gone.
- **Re-asking for notification permission** once the OS has recorded a denial.
- **Reading what arrived while I had somebody blocked.** It is hidden for good;
  an "unblock to catch up" affordance would promise something that cannot happen.
- **Un-hiding a group you left.** A hidden direct chat returns on the next
  message; a hidden group never does.
