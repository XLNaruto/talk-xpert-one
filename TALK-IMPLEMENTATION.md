# Talk — Frontend Implementation Guide

Everything a Talk client needs, from login to logout: the token system, the socket,
every event, every endpoint, and which side owns what.

**Scope: Talk only.** Nothing here applies to the `/user`, `/employee` or `/admin`
panels — Talk has its own audience, its own login and its own tokens.

---

## 1. The mental model

Three sentences that explain most of the design:

1. **You SEND over HTTP. You RECEIVE over the socket.** The socket accepts exactly
   three inbound messages — `talk:join`, `talk:leave` and `talk:typing` — and
   nothing else. Every write still goes over HTTP.
2. **The REST API is the source of truth; the socket is an accelerator.** A dropped
   connection loses nothing, because any gap is replayed with
   `GET /talk/chats/:id/messages?after_id=`.
3. **Everyone is a `talk_user_id`.** Not a user id, not an employee id. A
   back-office supervisor and a field employee are the same kind of participant in
   the same conversation.
4. **You must JOIN a conversation's room to receive its events.** Connecting is not
   enough — see §4.3. This is the single most common reason "the socket connects but
   nothing arrives".

### One socket, for the whole app

**Open exactly one socket and share it** (a singleton / context provider). Do not
open one for the sidebar and another for the thread.

The gateway joins each connection to two rooms — `account:<accountId>` and
`talk:<talkUserId>` — and there are no per-chat rooms. Events are addressed to the
**person**, not to a screen. So a second socket with the same token joins the same
rooms and **receives a duplicate of every event**: every incoming message renders
twice unless you dedupe by `message.id`.

The sidebar and the thread both need the same events anyway — `talk.message.new`
updates the chat list's preview and unread badge *and* appends to the open thread.
Subscribe both screens to the one socket and demultiplex on `chat_id`.

---

## 2. Bootstrap

### 2.1 Discover the socket URL

```http
GET /config          (no auth — this is on the public audience, mounted at the root)
```

```json
{
  "media_path": "https://cdn.dev.xpertoneindia.com/",
  "realtime_url": "https://ws.dev.xpertoneindia.com",
  "realtime_path": "/socket.io"
}
```

Read this once at launch. Do **not** hard-code the origins — they differ per
environment, and a hard-coded one means a client release every time one moves.

- `realtime_url` empty ⇒ this deployment has no realtime service. Fall back to
  polling; do not dial a broken host.
- `media_path` is the prefix for **every** file key Talk returns
  (`file_url`, `thumbnail_url`, `avatar_url`). Those fields are storage **keys**,
  not absolute URLs, despite the `_url` naming.

```js
const fileUrl = config.media_path + message.media[0].file_url;
```

---

## 3. Auth and the token system

Talk's login is **not** the XpertOne panel login. It is a separate credential
(`email` + `password`) that the tenant issues per person, so an employee — who has
no panel account at all — can still chat.

### 3.1 The platform is mandatory

Talk allows **one live session per operating system**:

```
ANDROID | IOS | MAC | WINDOWS | LINUX | WEB
```

An Android phone **and** an iPhone **and** a Mac **and** a browser can all be signed
in at once. A second **Android** login retires the first Android session — its token
stops working immediately.

Send your real platform. There is no default and no guessing: an unlabelled client
would fight every other unlabelled client for one slot.

### 3.2 Login

```http
POST /talk/auth/login
{ "email": "...", "password": "...", "platform": "WEB" }
```

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 1800,
  "token_type": "Bearer",
  "talk_user_id": 42,
  "account_id": 7,
  "platform": "WEB"
}
```

**Store `talk_user_id`.** It is how you decide "this message is mine" — compare it
against `sender_talk_user_id` on every message. It is not in the JWT for you to
read; take it from here (or from `GET /talk/me`).

| Failure | Status | What to show |
|---|---|---|
| Wrong password **or** unknown email | `401` | "Invalid email or password" — the server deliberately does not distinguish them |
| Credential suspended | `403` | "Your Talk access is suspended" — a login form is useless; do not retry |

### 3.3 Token lifetimes

| Token | Life | Notes |
|---|---|---|
| access | **30 min** (`expires_in`) | Sent as `Authorization: Bearer` on every request **and** at the socket handshake |
| refresh | **30 days** | Only ever sent to `/talk/auth/refresh` |

### 3.4 Refresh — the token ROTATES

```http
POST /talk/auth/refresh
{ "refresh_token": "..." }
→ { access_token, refresh_token, expires_in, token_type }
```

**The refresh token you sent is now dead. Store the new one immediately.** Each
refresh token works exactly once — that is what makes a stolen one self-limiting.

Three rules that follow from rotation:

1. **Serialise refreshes.** If five requests 401 at once and each fires its own
   refresh, four of them replay a spent token and get `401` — signing the user out
   for no reason. Keep a single in-flight refresh promise; queue everything else
   behind it and replay after it resolves.
2. **Persist the new token before replaying.** A crash between "got new tokens" and
   "wrote them" loses the session.
3. **Never send the refresh token anywhere but `/talk/auth/refresh`.**

You do not send `platform` here — it is taken from the token, so a refresh can never
move your session to a different OS slot.

### 3.5 What a 401 means mid-session

The access token is short, but it is not the only reason a request fails:

| Cause | Behaviour |
|---|---|
| Access token expired | Refresh, replay. Normal, every 30 min. |
| **Signed in on another device of the same OS** | Refresh also fails ⇒ sign out and show "You were signed in on another device". |
| Credential deleted | Refresh fails ⇒ sign out. |
| Credential **suspended** | `403`, not `401` ⇒ do **not** refresh, do **not** show a login form. Show "suspended". |

Rule of thumb: **`401` ⇒ try refresh once. `403` ⇒ stop.**

### 3.6 Who am I / my devices / logout

```http
GET  /talk/me              → { talk_user_id, account_id, email, platform }
GET  /talk/auth/sessions   → { platforms: ["WEB", "ANDROID"] }
POST /talk/auth/logout     { "all_devices": false }  → { signed_out: 1 }
```

`all_devices: false` (default) ends **only this platform's** session — the phone
signs out and the desktop stays in. `true` clears every platform, for a lost device.

Logout revokes both the live session and the stored refresh tokens, so it is a real
logout. It is idempotent — calling it with an already-dead token is not an error, so
always clear local state regardless of the response.

**On logout: disconnect the socket first, then call the endpoint, then clear
storage.** A socket left open on a dead token is refused at its next reconnect
anyway, but disconnecting first avoids a pointless reconnect storm.

---

## 4. The socket

### 4.1 Connect

```js
import { io } from 'socket.io-client';

const socket = io(config.realtime_url, {
  path: config.realtime_path,          // '/socket.io'
  auth: { token: accessToken },        // the SAME access token as REST
  transports: ['websocket'],
  reconnection: true,
});
```

The token may also go in an `Authorization: Bearer` header or a `?token=` query
param; `auth.token` is preferred. It must be the **access** token — a refresh token
is rejected.

### 4.2 Connection lifecycle

| Event | Meaning | What to do |
|---|---|---|
| `connect` | TCP/WS up | — |
| `connected` | Handshake accepted. `{ scope: 'talk', subject_id, account_id }` | `subject_id` is your `talk_user_id`. Now run the catch-up (§4.3). |
| `disconnect` | Dropped | Show a subtle "reconnecting" state. Do not clear the UI. |
| `connect_error` | Handshake refused | If the message is `unauthorized`: refresh the token, then reconnect with the new one. |

**The socket does not refresh its own token.** When you refresh (§3.4), update the
socket's auth and reconnect:

```js
socket.auth = { token: newAccessToken };
socket.disconnect().connect();
```

Otherwise the socket keeps a 30-minute token and dies silently at the half-hour.

### 4.3 Join the rooms you care about — REQUIRED

Connecting subscribes you to **your own** notifications only. Conversation events
(`talk.message.*`, `talk.member.*`, `talk.typing.*`) are delivered to a per-chat
room you must join.

```js
socket.emit('talk:join', { chat_id: 41 }, (res) => {
  if (!res.ok) {
    // 'not permitted' — the grant lapsed or was never issued.
    // Re-read the chat (GET /talk/chats/:id), which re-issues it, then retry ONCE.
  }
});

socket.emit('talk:leave', { chat_id: 41 });   // no ack, never fails
```

**Why a join at all.** The gateway holds no database, so it cannot work out who is
in chat 41. The API answers that during any read that already proves membership —
`GET /talk/chats`, `GET /talk/chats/:id`, `GET /talk/chats/:id/messages` — and
records a short-lived **grant** in Redis. `talk:join` is a key lookup against it.

**So the order matters: fetch first, then join.** A join with no preceding read is
refused.

Practical rules:

- After `GET /talk/chats`, join **every chat on the page** — that is what keeps the
  sidebar live (previews, unread badges) for chats you do not have open.
- On opening a thread, `GET .../messages` then join (harmless if already joined).
- Grants last **1 hour** and are refreshed by every read, so a client in normal use
  never notices. A long-idle tab may get `not permitted` on reconnect — re-read,
  re-join.
- `talk:leave` when a chat is closed **and you no longer need its sidebar updates**.
  Usually you do, so most clients only leave on logout.

**Losing access is immediate.** Leave a group, get removed, or have it disbanded and
the server both drops the grant and **evicts your socket from the room** — you stop
receiving that conversation at once, not when the grant expires.

### 4.4 Catch-up after every reconnect — mandatory

Realtime delivery is **best-effort and has no replay buffer**. Anything emitted
while you were disconnected is gone.

**Room membership does not survive a reconnect** — a new socket is in no rooms.

On every `connected`:

1. Re-fetch `GET /talk/chats` (fixes unread counts, previews, ordering — and
   refreshes the grants).
2. **Re-join every room** with `talk:join`.
3. For the open thread, fetch
   `GET /talk/chats/:id/messages?after_id=<newest id you hold>`.
4. Clear all typing indicators — they are ephemeral and yours are now stale.

Skipping step 2 is the classic bug: the socket reconnects, reports healthy, and
never delivers another message.

This is why the socket needs no durability: the REST API is the source of truth and
the gap is always replayable.

---

## 5. Events

Every chat event carries `chat_id`. All are **server → client**; there is nothing to
emit.

### 5.1 Messages

| Event | Payload | Sidebar | Thread |
|---|---|---|---|
| `talk.message.new` | `{ chat_id, message }` — the full message object | Bump to top, update preview, **+1 unread** if not the open chat | Append (dedupe by `message.id`) |
| `talk.message.edited` | `{ chat_id, message_id, body, edited_at }` | Update preview if it was the last | Replace body, show "edited" |
| `talk.message.deleted` | `{ chat_id, message_ids }` | Update preview | Render tombstone — **keep the bubble**, replies point at it |
| `talk.message.read` | `{ chat_id, message_ids, by_talk_user_id }` | — | Turn **your own** ticks blue |
| `talk.message.pinned`<br>`talk.message.unpinned` | `{ chat_id, message_id, by_talk_user_id }` | — | Update the pin bar |

`talk.message.new` fires for forwards too, with the same `{ message }` shape.

**You now DO receive your own actions.** Events go to the conversation's room, and
your own sockets are in it — there is no way to exclude a subject from outside the
socket layer. Two consequences:

- **Dedupe on `message.id`** (you should already, for reconnect races). Reconcile
  the optimistic bubble you rendered from the HTTP response instead of appending a
  second one.
- **Your other devices now stay in sync** — a message sent on your phone appears on
  your desktop. That is an improvement over the previous behaviour, which dropped
  it.

`talk.message.deleted` fires **only** for *delete for everyone*. *Delete for me* is
deliberately silent: the other party must never learn you hid their message.

### 5.2 Chats and members

| Event | Payload | What it means |
|---|---|---|
| `talk.chat.created` | `{ chat_id, type, name? }` | You were added to a new chat — insert into the list |
| `talk.chat.updated` | `{ chat_id, name, description, avatar_url }` | Group renamed / repictured |
| `talk.chat.deleted` | `{ chat_id, by_talk_user_id }` | Group disbanded — remove from the list, close if open |
| `talk.member.added` | `{ chat_id, talk_user_ids, by_talk_user_id }` | Refresh members |
| `talk.member.left` | `{ chat_id, talk_user_id }` | They left |
| `talk.member.removed` | `{ chat_id, talk_user_id, by_talk_user_id }` | Removed by the owner. **If it is you, remove the chat** — you were told just before it took effect |
| `talk.member.blocked` | `{ chat_id, talk_user_id, blocked, by_talk_user_id }` | If it is you: **disable the composer**, keep the chat readable |

`left` and `removed` are separate events on purpose — the group is told a different
sentence for each.

### 5.3 Typing

| Event | Payload |
|---|---|
| `talk.typing.start` | `{ chat_id, talk_user_id }` |
| `talk.typing.stop` | `{ chat_id, talk_user_id }` |

**Send typing over the SOCKET, not HTTP:**

```js
socket.emit('talk:typing', { chat_id: 41, typing: true });
socket.emit('talk:typing', { chat_id: 41, typing: false });
```

It is relayed socket-to-socket and never reaches the database — which is the point,
since a typing signal fires every few seconds per active composer. You must have
joined the room first (§4.3); a signal for a room you are not in is ignored. The
sender is excluded, so you never see your own indicator.

`POST /talk/chats/:chat_id/typing` still exists as a fallback for a client with no
socket, but costs an HTTP round trip and a membership query. **Prefer the socket.**

**Two client responsibilities the server does not handle:**

1. **Throttle.** Send `typing: true` at most once every ~3–5 s while the composer is
   active — **never per keystroke**. Nothing rate-limits this server-side yet.
2. **Expire.** Hide the indicator ~5 s after the last signal. **Do not wait for
   `stop`** — a client that crashes mid-sentence never sends one. Treat `stop` as an
   optimisation, not a guarantee.

```js
// per (chat_id, talk_user_id)
clearTimeout(timers[key]);
timers[key] = setTimeout(() => hideTyping(key), 5000);
```

Also clear every indicator on reconnect and on chat close.

### 5.4 Presence

| Event | Payload |
|---|---|
| `talk.presence` | `{ talk_user_id, is_online, at }` — **no `chat_id`** |

This is the one Talk event **broadcast to the whole account**, because the gateway
holds no database and cannot work out who shares a conversation with whom. **Filter
client-side** to the people you actually display — you will receive presence for
colleagues you have never messaged.

Presence goes stale after ~70 s without a heartbeat, so "offline" can lag by up to a
minute if a client dies without closing cleanly. A clean disconnect is immediate.

---

## 6. Endpoints

`Authorization: Bearer <access_token>` on everything except login and refresh.

### 6.1 Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/talk/auth/login` | `{ email, password, platform }` |
| POST | `/talk/auth/refresh` | `{ refresh_token }` — rotates |
| POST | `/talk/auth/logout` | `{ all_devices? }` |
| GET | `/talk/auth/sessions` | Which platforms are signed in |
| GET | `/talk/me` | Your `talk_user_id` |

### 6.2 Chat list

| Method | Path | Notes |
|---|---|---|
| GET | `/talk/chats` | `?search= &type=direct\|group &pinned_only= &unread_only= &limit= &offset=` |
| GET | `/talk/chats/unread-summary` | `{ total_unread }` — the app badge |
| GET | `/talk/chats/:chat_id` | Same shape as a list row |
| POST | `/talk/chats/direct` | `{ talk_user_id }` → `{ chat_id, created }` — **idempotent** |
| POST | `/talk/chats/group` | `{ name, description?, avatar_url?, company_id?, talk_user_ids[] }` |
| PATCH | `/talk/chats/:chat_id` | Rename / description / avatar — **owner only** |
| DELETE | `/talk/chats/:chat_id` | Disband the group for everyone — **owner only** |
| POST | `/talk/chats/delete` | `{ chat_ids[] }` — hide from **my** list. **Direct chats only** |
| POST | `/talk/chats/read` | `{ chat_ids[], upto_message_id? }` — one or fifty |
| PUT | `/talk/chats/:chat_id/pin` | `{ pinned }` — **my** list only, private |
| POST | `/talk/chats/:chat_id/avatar/presign` | Upload URL for the group picture — owner only |

**`search` must be server-side.** It matches a group on its name *and* a direct chat
on the other participant's name — the second cannot be done client-side against the
response.

### 6.3 Members

| Method | Path | Notes |
|---|---|---|
| GET | `/talk/chats/:chat_id/members` | Any member may read |
| POST | `/talk/chats/:chat_id/members` | `{ talk_user_ids[] }` — owner only |
| POST | `/talk/chats/:chat_id/leave` | Owner **cannot** leave — delete the group instead |
| DELETE | `/talk/chats/:chat_id/members/:talk_user_id` | Owner only |
| PUT | `/talk/chats/:chat_id/members/:talk_user_id/block` | `{ blocked }` — owner only. Reads on, posting off |

### 6.4 Messages

| Method | Path | Notes |
|---|---|---|
| GET | `/talk/chats/:chat_id/messages` | `?limit= &before_id= &after_id=` |
| POST | `/talk/chats/:chat_id/messages` | See §7 |
| PATCH | `/talk/chats/:chat_id/messages/:message_id` | `{ body }` — **sender only**; edits the caption on a media message |
| POST | `/talk/chats/:chat_id/messages/delete` | `{ message_ids[], for_everyone? }` |
| POST | `/talk/messages/forward` | `{ message_ids[], to_chat_ids[] }` |
| GET | `/talk/messages/search` | `?q= &chat_id? &limit= &offset=` |
| PUT | `/talk/chats/:chat_id/messages/:message_id/pin` | `{ pinned, expires_at? }` — chat-wide |
| GET | `/talk/chats/:chat_id/pins` | The pin bar |
| GET | `/talk/chats/:chat_id/messages/:message_id/receipts` | **Sender only** (404 otherwise) |
| GET | `/talk/chats/:chat_id/media` | `?kind=image\|video\|audio\|document &limit= &offset=` |
| POST | `/talk/chats/:chat_id/media/presign` | Upload URL for an attachment — **max 25 MB** |

Paging: `before_id` scrolls up through history; `after_id` is the reconnect
catch-up.

### 6.5 Blocks, presence, typing

| Method | Path | Notes |
|---|---|---|
| PUT | `/talk/blocks` | `{ talk_user_id, blocked }` — direct chats, account-wide |
| GET | `/talk/blocks` | Who **you** blocked (never who blocked you) |
| GET | `/talk/presence` | `?talk_user_ids=12,15,31` |
| GET | `/talk/chats/:chat_id/presence` | Everyone in one chat |
| POST | `/talk/chats/:chat_id/typing` | `{ typing }` → `204` |

---

## 7. Sending a message

```http
POST /talk/chats/:chat_id/messages
{
  "body": "hello",
  "client_message_id": "<uuid>",
  "reply_to_message_id": 91,
  "media": [
    { "kind": "image", "file_url": "<storage key>", "file_name": "a.jpg",
      "mime_type": "image/jpeg", "size_bytes": 12345, "width": 800, "height": 600,
      "thumbnail_url": "<key>" }
  ]
}
```

Needs **text, attachments, or both** — neither is a `400`.

### `client_message_id` — always send one

A fresh UUID per send makes the request **idempotent**: retry on a flaky connection
with the same value and you get the *same* message back, not a second bubble. This
is the single most visible bug a chat can have; the server can only prevent it if
you supply the id.

Use it as the key for the optimistic bubble, then reconcile with the response.

### Attachments — the three-step upload

```
1. POST /talk/chats/:chat_id/media/presign
   { "content_type": "image/jpeg", "size_bytes": 84213, "file_name": "photo.jpg" }
   → { "upload_url": "...", "key": "accounts/7/talk/chats/12/<uuid>-photo.jpg" }

2. PUT <upload_url>
   Content-Type:   image/jpeg        ← MUST match what you asked for
   Content-Length: 84213             ← MUST be exactly size_bytes
   <bytes>

3. POST /talk/chats/:chat_id/messages
   { "media": [{ "kind": "image", "file_url": "<key from step 1>", ... }] }
```

**Max 25 MB per attachment.** `size_bytes` is required, and the number is *signed
into* the upload URL — S3 itself rejects a body of any other size, so
under-reporting does not buy a bigger upload. Over 25 MB is a `400` before any URL
is issued.

**Accepted:** images (jpeg, png, webp, gif, heic), video (mp4, mov, webm), audio
(mp3, m4a, aac, ogg, wav, webm), documents (pdf, doc/docx, xls/xlsx, ppt/pptx, txt,
csv), zip/rar.
**Not accepted:** executables, `.html`, `.svg` — anything a browser would run.

The presign is refused for the same reasons a send is (you left, were removed, were
blocked from posting), so resolve those before showing a file picker.

Display with `media_path + file_url`. The message `type` is derived server-side from
what you send — do not try to set it.

### Group picture

Same shape, its own route, no size field:

```
POST /talk/chats/:chat_id/avatar/presign
{ "content_type": "image/png", "file_name": "team.png" }
→ { upload_url, key }

PATCH /talk/chats/:chat_id   { "avatar_url": "<key>" }
```

Images only, and **group owner only** — the same authority the `PATCH` requires, so
you cannot upload successfully and then be refused when you save.

### Refusals

| Status | Cause |
|---|---|
| `403` | You left, were removed, or were blocked from posting by the group owner |
| `403` "Unblock this person…" | **You** blocked them — offer to unblock |
| `403` "could not be delivered" | **They** blocked you. Deliberately vague — do not reveal it as a block |
| `400` | `reply_to_message_id` is not in this chat |
| `404` | Chat does not exist **or** you are not in it — the two are indistinguishable by design |

---

## 8. Screen wiring

### Chat list

- Load `GET /talk/chats`; re-fetch on reconnect.
- **Already sorted** — pinned first, then newest. Do not re-sort.
- `unread_count` per row; `self.is_pinned` for the pin marker.
- Direct chats have `name: null` and `avatar_url: null` — draw them from
  `counterpart_name` / `counterpart_photo` (the id is for comparisons, not for
  display). A group row uses its own `name` and `avatar_url`, and prefixes the
  preview with `last_message_sender_name`.
- **Every person-shaped field now carries a `name` and a `photo` beside its id** —
  `sender_*` on a message and on its inline `reply_to`, `created_by_*`,
  `counterpart_*`, `last_message_sender_*`, `blocked_by_*`, `pinned_by_*`, and a
  plain `name`/`photo` pair on a member, a receipt, a presence row and a block.
  Both are nullable, and `photo` is a storage **KEY**: prefix it with `media_path`
  from `GET /config`, exactly like every other `*_url`.
- The two socket events that carry NO name are `talk.typing.*` and
  `talk.presence` — cache what the REST reads named, or the indicator says
  "Member 42 is typing…".
- Presence dots: `GET /talk/presence` with the counterpart ids, then live-update
  from `talk.presence`.
- Live updates from `talk.message.new`, `.edited`, `.deleted`, `talk.chat.*`.

### Thread

- `GET /talk/chats/:id/messages`, newest first — reverse for display.
- `reply_to` is **inline** — render the quote directly, no second request.
- On open (and on new messages while open): `POST /talk/chats/read` with that
  `chat_id`. This clears the badge *and* turns the sender's ticks blue.
- Ticks: `is_read_by_all` / `read_count` are populated **only on your own
  messages** — always `false`/`0` on others'.
- Composer: disabled when `self.is_blocked` or `self.has_left`.

### Bulk actions

- Multi-select delete → `POST /talk/chats/delete`. **Filter groups out in the UI** —
  the API refuses them with a `400` naming the offending ids.
- "Mark all read" → `POST /talk/chats/read` with every id, no `upto_message_id`.

---

## 9. Client responsibilities checklist

| # | Responsibility | Consequence if skipped |
|---|---|---|
| 0 | **Join each chat's room** (`talk:join`), and re-join on reconnect | Socket connects, nothing ever arrives |
| 1 | One shared socket | Every message renders twice |
| 2 | Dedupe by `message.id` | Duplicates — you receive your **own** events too |
| 3 | Send `client_message_id` | Retries post duplicate messages |
| 4 | Serialise token refresh | Concurrent 401s sign the user out |
| 5 | Reconnect the socket after refresh | Socket dies silently at 30 min |
| 6 | Catch up with `after_id` on reconnect | Silently missing messages |
| 7 | Throttle typing, and send it over the socket | Keystroke-rate HTTP load |
| 8 | Expire typing after ~5 s | Indicator stuck forever |
| 9 | Filter `talk.presence` | Presence for the whole organisation |
| 10 | Prefix keys with `media_path` | Broken images |
| 11 | `403` ⇒ do not refresh | Sign-out loop on a suspended account |

---

## 10. Gotchas

- **`404` vs `403` on a chat.** A chat you are not in returns `404`, never `403` — a
  `403` would confirm it exists. Do not read `404` as "deleted".
- **Deleted messages keep their bubble.** `is_deleted_for_everyone: true` with
  `body: null` — render the tombstone; replies still point at it.
- **Two different pins.** `PUT /talk/chats/:id/pin` pins the chat in *your* list
  (private). `PUT /talk/chats/:id/messages/:id/pin` pins a message for *everyone*.
- **Two different blocks.** `PUT /talk/blocks` is your private, account-wide block
  in direct chats — the other person is never told. The group owner's block
  (`.../members/:id/block`) is announced and only silences posting.
- **Leaving vs deleting.** Direct chat → `POST /talk/chats/delete` (hides it from
  you). Group → leave, or delete if you own it.
- **A "deleted" direct chat comes back** when a newer message arrives, with the old
  messages still hidden. That is intended.
- **`talk_user_id` is not a user or employee id.** Never mix them.
