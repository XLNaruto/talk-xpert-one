# Talk over the socket — the full event contract, and how to build the FE on it

Who this is for: the **Talk client dev** (web, Android, iOS). It documents every
message that crosses the socket in either direction, which ones pair with which,
and the client architecture that falls out of that.

**What changed.** The socket used to accept three messages (`talk:join`,
`talk:leave`, `talk:typing`). Everything else a client *did* went over HTTP while
its *consequence* came back over the socket, so every gesture spanned two
transports with two failure modes. Every write is now also an inbound socket
event, and its ack carries exactly what the HTTP route returns.

**HTTP is not deprecated.** Reads are still HTTP and there is no plan to change
that (§9). A client may use either transport for writes, or mix them — they are
the same code path. If your app already works over HTTP, nothing broke.

---

## Contents

1. [The model in one picture](#1-the-model-in-one-picture)
2. [Connecting](#2-connecting)
3. [Keeping the token fresh — the thing you cannot skip](#3-keeping-the-token-fresh--the-thing-you-cannot-skip)
4. [Rooms: why a chat has to be joined](#4-rooms-why-a-chat-has-to-be-joined)
5. [The ack contract](#5-the-ack-contract)
6. [Inbound events — what you send](#6-inbound-events--what-you-send)
7. [Outbound events — what you receive](#7-outbound-events--what-you-receive)
8. [How they pair](#8-how-they-pair)
9. [What is still HTTP only](#9-what-is-still-http-only)
10. [Building the client](#10-building-the-client)
11. [Gotchas that will bite](#11-gotchas-that-will-bite)

---

## 1. The model in one picture

```
                    ┌──────────────────────────────────────────┐
   YOU              │            THE GATEWAY                   │        THE API
   (one socket)     │      apps/realtime — no database         │   /talk/* routes
                    │                                          │
  emit ─────────────┼──► talk:message.send ──── bridged ────────┼──► POST /talk/chats/:id/messages
                    │                                          │        │
  ack  ◄────────────┼──── { ok, status, data } ◄────────────────┼────────┘ (the HTTP response)
                    │                                          │        │
                    │                                          │        └─► publish to the chat's room
  on() ◄────────────┼──── talk.message.new ◄───── Redis ────────┼────────────┘
                    │                                          │
  emit ─────────────┼──► talk:typing ──┐  never leaves here     │
  on() ◄────────────┼──── talk.typing.start ◄──┘                │
                    └──────────────────────────────────────────┘
```

Three things follow from this and they explain most of the API's shape:

- **The gateway holds no database.** An inbound event is a reference to the REST
  route that owns the operation; the gateway calls it with *your own* bearer
  token. So the policies, validation, error messages and response bodies are
  identical to HTTP — because they *are* HTTP, one hop away. There is no second
  implementation to drift.
- **Your ack and everyone's event are different deliveries.** The ack is the
  route's response, to you alone. The event is the route's *announcement*, to the
  conversation's room. You get both (§11).
- **Typing is the exception.** `talk:typing` is relayed socket-to-socket and never
  reaches the API. A keystroke-rate signal must not become an HTTP request.

Naming tells you the direction: **inbound is `talk:` with a colon** and an
imperative (`talk:message.send`); **outbound is `talk.` with a dot** and a past
participle (`talk.message.new`).

---

## 2. Connecting

You need a Talk access token — `POST /talk/auth/login`, which is Talk's own login
and **not** the panel login:

```json
{
  "access_token": "…", "refresh_token": "…",
  "expires_in": 1800, "token_type": "Bearer",
  "talk_user_id": 41, "account_id": 7,
  "platform": "android", "name": "Asha Patel", "photo": "…"
}
```

The socket origin comes from `GET /public/config` as `realtime_url`. **If it is
empty there is no realtime service in this environment** — fall back to HTTP and
polling rather than dialling a guess.

```ts
import { io } from 'socket.io-client';

const socket = io(realtimeUrl, {
  auth: { token: accessToken },   // preferred; ?token= and Authorization also work
  transports: ['websocket'],
  reconnection: true,
});
```

It must be an **access** token. A refresh token is signed with the same key and is
rejected here on purpose — accepting one would turn a credential that may only be
spent at `/talk/auth/refresh` into a live session.

The server replies with one event immediately:

```ts
socket.on('connected', (p) => {
  // { scope: 'talk', subject_id: 41, account_id: 7, name: 'Asha Patel', photo: '…' }
});
```

`subject_id` is your `talk_user_id`. Treat `connected` as "the handshake was
accepted" — it is the only positive confirmation you get, since a rejected
handshake surfaces as `connect_error` with the message `unauthorized`.

---

## 3. Keeping the token fresh — the thing you cannot skip

A Talk access token lives **30 minutes**. A socket lives as long as the app is
open. Every inbound event spends that token on your behalf, so **without this
step your sends start failing 401 about half an hour in — while the connection
itself still looks perfectly healthy.** That is the single most confusing failure
mode in this contract, and it is entirely avoidable.

You already refresh on a timer for your HTTP calls. Tell the socket too:

```ts
async function refresh() {
  const pair = await POST('/talk/auth/refresh', { refresh_token: refreshToken });
  accessToken = pair.access_token;
  refreshToken = pair.refresh_token;

  // Replace the socket's bearer IN PLACE — no reconnect, no lost rooms.
  socket.emit('talk:auth.token', { token: accessToken }, (r) => {
    if (!r.ok) socket.disconnect();   // reconnect with the new token instead
  });

  // Also update the handshake, so an automatic RECONNECT uses the new token.
  socket.auth = { token: accessToken };

  setTimeout(refresh, (pair.expires_in - 120) * 1000);   // refresh ~2 min early
}
```

Both lines matter and they do different jobs: `talk:auth.token` fixes the *live*
socket, `socket.auth` fixes the *next* handshake. Set only the first and a
reconnect dies on an expired token; set only the second and your sends 401 until
something forces a reconnect.

The replacement is re-verified with the handshake's own checks and must name the
**same subject and account**. A token for a different person is rejected, not
accepted as a re-identification — a socket's rooms and presence were established
under one identity and cannot change underneath them.

Belt and braces: treat `status: 401` on any ack as "refresh now, then retry once."

---

## 4. Rooms: why a chat has to be joined

Most events are delivered to a **chat room**, and a socket is only in a room it
explicitly joined. The gateway has no database, so it cannot answer "is this
person in chat 42" — the API answers it during a read and leaves a **grant** in
Redis naming the room *and* you. `talk:join` is a grant lookup.

```
  GET /talk/chats            ─► grants every chat on that page   (one call, whole inbox)
  GET /talk/chats/:id        ─► grants that chat
  GET /talk/chats/:id/messages ─► grants that chat
                                      │
                                      ▼  grant lives 1 hour, refreshed by any read
  socket.emit('talk:join', { chat_id: 42 }, ack)   ─► { ok: true }
                                      │
                                      ▼
  now talk.message.new / .edited / … for chat 42 reach this socket
```

**So: read before you join.** In practice the chat-list call you already make on
launch grants the whole page at once, which is why an ordinary client keeps its
grants alive simply by using the app.

```ts
socket.emit('talk:join', { chat_id: 42 }, (r) => {
  if (!r.ok) {
    // 'not permitted' = no grant. Re-read the chat, which re-issues it, then retry.
    // Do NOT retry blindly — you may genuinely no longer be a member.
  }
});

socket.emit('talk:leave', { chat_id: 42 });   // no ack; a socket may always stop listening
```

Two events reach you **without any join**, because they are addressed to you
personally on `talk:<your id>`, which the gateway joins at connect:

| event | why it must not need a join |
| --- | --- |
| `talk.chat.created` | you cannot have joined a chat that did not exist |
| `talk.member.removed` (your own copy) | you are told *before* the removal, then cut off |

`talk.presence` is broadcast to your whole account — see §7.

**Losing access is immediate.** Leaving, being removed, or the group being
disbanded revokes the grant *and* evicts your socket from the room in the same
breath. You do not have to do anything; you simply stop receiving.

---

## 5. The ack contract

Every inbound event in §6 answers through the socket.io ack callback. One shape,
two branches:

```ts
type TalkAck =
  | { ok: true;  status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };
```

- `status` is the **HTTP status the route returned**, so whatever error-mapping
  table you already have for the REST API keeps working unchanged.
- `error` is the API's own `{ code, message, details }` envelope, passed through
  verbatim. The messages are written for users; don't rewrite them client-side.
- `data` is the route's response body — byte-identical to the HTTP one.

Statuses you should handle explicitly:

| status | code | what it means | what to do |
| --- | --- | --- | --- |
| `400` | `VALIDATION` | bad payload; `details` has the Zod issues | fix the call — it is a bug |
| `401` | `UNAUTHORIZED` | the access token expired under the socket | refresh (§3), retry once |
| `403` | *varies* | you left the chat, were removed, or were blocked from posting | surface it; refresh the chat |
| `404` | *varies* | the chat or message is gone | drop the optimistic row, re-read |
| `409` | *varies* | conflict (e.g. deleting a role still in use) | surface the message |
| `503` | `UNAVAILABLE` | the gateway could not reach the API (timeout is 15s) | retry with backoff |

**Passing no ack is legal** and means fire-and-forget. Failures are still logged
server-side, so a dropped error is not a silent one — but you will not learn about
it, so only do this where you genuinely don't care.

---

## 6. Inbound events — what you send

One **flat snake_case object** per event: the union of what you put in the URL and
the body today. `{ chat_id: 42, body: 'hi' }` is the same information as
`POST /talk/chats/42/messages` with `{ body: 'hi' }`. Ids that appear in the path
must be positive integers — they are validated before the URL is built, so a
string is refused with a clear message rather than producing a mystery 404.

Field-level rules (lengths, what may be null, which combinations are refused) are
**not** repeated here; they are the route's own schema and live in Swagger at
`/talk/docs`. This table is the map from event to route.

### Messages

| event | payload | bridged to | ack `data` |
| --- | --- | --- | --- |
| `talk:message.send` | `chat_id`, `body?`, `media?[]`, `reply_to_message_id?`, `client_message_id?` | `POST /talk/chats/:chat_id/messages` | the full message (`TalkMessageResponse`) |
| `talk:message.edit` | `chat_id`, `message_id`, `body` | `PATCH …/messages/:message_id` | `{ message_id, edited_at }` |
| `talk:message.delete` | `chat_id`, `message_ids[]`, `for_everyone` | `POST …/messages/delete` | `{ affected }` |
| `talk:message.forward` | `message_ids[]`, `to_chat_ids[]` | `POST /talk/messages/forward` | `{ forwarded }` |
| `talk:message.read` | `chat_ids[]`, `upto_message_id?` | `POST /talk/chats/read` | `{ affected }` |
| `talk:message.pin` | `chat_id`, `message_id`, `pinned`, `expires_at?` | `PUT …/messages/:message_id/pin` | `{ pinned }` |

`client_message_id` makes a send **idempotent**: retry the same value over a flaky
connection and the same message comes back rather than a second bubble. Use it —
it is what makes safe retry possible at all.

`talk:message.pin` is one event for both directions; `pinned` decides which of the
two outbound events fires. `talk:message.read` takes a list, so the "mark all
read" button is one emit.

### Chats

| event | payload | bridged to | ack `data` |
| --- | --- | --- | --- |
| `talk:chat.create.direct` | `talk_user_id` | `POST /talk/chats/direct` | `{ chat_id, created }` |
| `talk:chat.create.group` | `name`, `talk_user_ids[]`, `description?`, `avatar_url?`, `company_id?` | `POST /talk/chats/group` | `{ chat_id }` (201) |
| `talk:chat.update` | `chat_id`, `name?`, `description?`, `avatar_url?` | `PATCH /talk/chats/:chat_id` | `{ chat_id }` |
| `talk:chat.delete` | `chat_id` | `DELETE /talk/chats/:chat_id` | `{ deleted }` |

Two create events rather than one because they are two routes: a direct chat is
**idempotent** (`created` tells you whether it already existed, so the contact-tap
never has to know), a group is a create returning 201.

`talk:chat.delete` disbands a **group for everyone**. Hiding a chat from your own
list is a different operation and is HTTP only — see §9.

### Members

| event | payload | bridged to | ack `data` |
| --- | --- | --- | --- |
| `talk:member.add` | `chat_id`, `talk_user_ids[]` | `POST …/members` | `{ added }` |
| `talk:member.leave` | `chat_id` | `POST …/leave` | `{ left }` |
| `talk:member.remove` | `chat_id`, `talk_user_id` | `DELETE …/members/:talk_user_id` | `{ removed }` |
| `talk:member.block` | `chat_id`, `talk_user_id`, `blocked` | `PUT …/members/:talk_user_id/block` | `{ blocked }` |

`talk:member.block` is the group creator's block, which keeps a member *reading*
while stopping them *posting*. It is not the private account-wide block between
two people — that one is HTTP only and deliberately silent (§9).

### The three that are not bridges

| event | payload | ack | what it does |
| --- | --- | --- | --- |
| `talk:join` | `{ chat_id }` | `{ ok, error? }` | subscribe to a chat's room (§4) |
| `talk:leave` | `{ chat_id }` | none | stop listening |
| `talk:typing` | `{ chat_id, typing }` | none | relay to the room; never touches the API |
| `talk:auth.token` | `{ token }` | `{ ok, error? }` | replace the bearer in place (§3) |

`talk:typing` requires you to be **in the room** (a grant-checked join), and
`socket.to()` excludes you, so you are never shown your own indicator.

---

## 7. Outbound events — what you receive

Every payload carries `type` (its own name, so one handler can switch) and — for
everything delivered to a chat room — `chat_id`.

Names on people (`name`, `photo`, `by_name`, `by_photo`) are included on purpose
so you can render an event **before** you have loaded that person's directory
entry. `photo` is a storage **key**: prefix it with `media_path` from
`GET /public/config`.

### Messages

| event | payload | delivered to |
| --- | --- | --- |
| `talk.message.new` | `chat_id`, `message` (full `TalkMessageResponse`) | chat room |
| `talk.message.edited` | `chat_id`, `message_id`, `body`, `edited_at` | chat room |
| `talk.message.deleted` | `chat_id`, `message_ids[]` | chat room |
| `talk.message.read` | `chat_id`, `message_ids[]`, `by_talk_user_id`, `by_name`, `by_photo` | chat room |
| `talk.message.pinned` | `chat_id`, `message_id`, `by_talk_user_id`, `by_name`, `by_photo` | chat room |
| `talk.message.unpinned` | *same as pinned* | chat room |

`talk.message.deleted` fires **only for delete-for-everyone**. A delete-for-me
changes nothing anyone else can see, so nothing is announced — your own ack is the
whole story.

`talk.message.read` names only the receipts that **actually changed**, so
re-marking an already-read chat notifies nobody.

### Chats

| event | payload | delivered to |
| --- | --- | --- |
| `talk.chat.created` | `chat_id`, `type` (`'direct'`/`'group'`), `name?`, `created_by_talk_user_id`, `created_by_name`, `created_by_photo` | **you personally** |
| `talk.chat.updated` | `chat_id`, `name`, `description`, `avatar_url` | chat room |
| `talk.chat.deleted` | `chat_id`, `by_talk_user_id`, `by_name`, `by_photo` | chat room |

`talk.chat.created` arrives without a join (§4) — it is how you learn a colleague
opened a thread with you. Handle it by inserting the row and reading the chat,
which grants the room so you can join it.

`talk.chat.deleted` is announced *before* the disband, while members are still
subscribed. You will be evicted immediately after, so treat it as final.

### Members

| event | payload | delivered to |
| --- | --- | --- |
| `talk.member.added` | `chat_id`, `talk_user_ids[]`, `members[]` (`{talk_user_id,name,photo}`), `by_talk_user_id`, `by_name`, `by_photo` | chat room |
| `talk.member.left` | `chat_id`, `talk_user_id`, `name`, `photo` | chat room |
| `talk.member.removed` | `chat_id`, `talk_user_id`, `name`, `photo`, `by_talk_user_id`, `by_name`, `by_photo` | chat room **and** the removed person |
| `talk.member.blocked` | `chat_id`, `talk_user_id`, `name`, `photo`, `blocked`, `by_talk_user_id`, `by_name`, `by_photo` | chat room |

`talk.member.removed` is sent **twice, by design**: once to the person being
removed (who is cut off a moment later and would otherwise never learn of it) and
once to the room. If `talk_user_id` is you, leave the chat screen.

### Ephemera

| event | payload | delivered to |
| --- | --- | --- |
| `talk.typing.start` | `chat_id`, `talk_user_id`, `name`, `photo` | chat room, sender excluded |
| `talk.typing.stop` | *same* | chat room, sender excluded |
| `talk.presence` | `talk_user_id`, `name`, `photo`, `is_online`, `at` | **your whole account** |

`talk.presence` is the one Talk event broadcast rather than addressed, and it is a
deliberate trade: the gateway has no database and cannot expand "who shares a
conversation with this person". What it discloses is "this colleague is online in
Talk", to your own tenant only — never across organizations. **Filter it to the
people you actually display.**

Presence is *not* stored: it is a Redis heartbeat with a 70-second expiry, so a
crashed client heals itself. The launch snapshot comes from
`GET /talk/presence?talk_user_ids=…`; the live changes come from here.

---

## 8. How they pair

Read this as "I do X → I get back Y → everyone in the chat gets Z".

| you emit | your ack | the room receives |
| --- | --- | --- |
| `talk:message.send` | the stored message | `talk.message.new` |
| `talk:message.forward` | `{ forwarded }` | `talk.message.new` — **once per destination chat** |
| `talk:message.edit` | `{ message_id, edited_at }` | `talk.message.edited` |
| `talk:message.delete` (`for_everyone: true`) | `{ affected }` | `talk.message.deleted` |
| `talk:message.delete` (`for_everyone: false`) | `{ affected }` | *nothing* |
| `talk:message.read` | `{ affected }` | `talk.message.read` (per chat) |
| `talk:message.pin` (`pinned: true`) | `{ pinned }` | `talk.message.pinned` |
| `talk:message.pin` (`pinned: false`) | `{ pinned }` | `talk.message.unpinned` |
| `talk:chat.create.direct` | `{ chat_id, created }` | `talk.chat.created` → **the other person** |
| `talk:chat.create.group` | `{ chat_id }` | `talk.chat.created` → **each member** |
| `talk:chat.update` | `{ chat_id }` | `talk.chat.updated` |
| `talk:chat.delete` | `{ deleted }` | `talk.chat.deleted`, then everyone is evicted |
| `talk:member.add` | `{ added }` | `talk.member.added` + a `member_added` system message |
| `talk:member.leave` | `{ left }` | `talk.member.left` |
| `talk:member.remove` | `{ removed }` | `talk.member.removed` ×2 (§7) + a system message |
| `talk:member.block` | `{ blocked }` | `talk.member.blocked` |
| `talk:typing` | *none* | `talk.typing.start` / `.stop` |
| `talk:join` / `talk:leave` | `{ ok }` / none | *nothing* |

Note what is **absent** and is meant to be:

- **The private direct-chat block** (`PUT /talk/blocks`) emits nothing, ever.
  Being blocked is meant to be indistinguishable from being ignored — announcing
  it to the blocked person defeats the whole feature, and announcing it to the
  blocker buys nothing their own response did not already say.
- **Delete-for-me** emits nothing (nobody else's view changed).
- **Presence has no inbound event.** It is a property of the connection, not
  something a client asserts.

---

## 9. What is still HTTP only

Reads, uploads, and two writes. This is not an oversight — request/response is the
right shape for paging and for a presign you immediately follow with an S3 PUT.

| what | route |
| --- | --- |
| the chat list (**also grants rooms**) | `GET /talk/chats` |
| unread badge | `GET /talk/chats/unread-summary` |
| one chat (**also grants its room**) | `GET /talk/chats/:id` |
| a page of messages (**also grants**) | `GET /talk/chats/:id/messages` |
| member list, pins, receipts, media gallery | `GET /talk/chats/:id/{members,pins,media}`, `…/messages/:id/receipts` |
| message search | `GET /talk/messages/search` |
| the contact directory | `GET /talk/contacts` |
| presence snapshot | `GET /talk/presence` |
| media / avatar presign | `POST /talk/chats/:id/{media,avatar}/presign` |
| **hide a chat from my own list** | `POST /talk/chats/delete` |
| **the private account-wide block** | `PUT /talk/blocks`, `GET /talk/blocks` |
| pin a chat to my list | `PUT /talk/chats/:id/pin` |
| login / refresh / sessions | `POST /talk/auth/*` |

Sending a file is therefore still a three-step dance, and only the last step moved:

```
1. POST /talk/chats/42/media/presign   → { upload_url, key }     (HTTP)
2. PUT  <upload_url>  with the bytes                             (direct to S3)
3. emit 'talk:message.send' { chat_id: 42, media: [{ kind: 'image', file_url: key }] }
```

The caption travels in `body` on the **same** message as the file — a photo with
words under it is one bubble, not two.

---

## 10. Building the client

### A thin wrapper is all you need

```ts
type Ack<T> = { ok: true; status: number; data: T }
            | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

class TalkSocket {
  private socket: Socket;
  private joined = new Set<number>();

  constructor(url: string, private tokens: TokenStore) {
    this.socket = io(url, { auth: { token: tokens.access }, transports: ['websocket'] });

    // Re-establish everything the new socket does not remember.
    this.socket.on('connect', () => void this.resync());
  }

  /** One promise-shaped call for every bridged event, with a single 401 retry. */
  private async call<T>(event: string, payload: object, retried = false): Promise<T> {
    const ack = await new Promise<Ack<T>>((res) => this.socket.emit(event, payload, res));
    if (ack.ok) return ack.data;
    if (ack.status === 401 && !retried) {
      await this.tokens.refresh();                       // also emits talk:auth.token
      return this.call<T>(event, payload, true);
    }
    throw new TalkError(ack.status, ack.error);          // same shape your HTTP layer throws
  }

  sendMessage(i: SendMessageInput) { return this.call<TalkMessage>('talk:message.send', i); }
  editMessage(i: EditInput)        { return this.call('talk:message.edit', i); }
  markRead(i: ReadInput)           { return this.call('talk:message.read', i); }
  // … one line per event in §6
}
```

Because the ack carries the same status and the same error envelope as HTTP, this
wrapper can throw the **same error type** your fetch layer already throws — so
screens above it do not know or care which transport ran.

### Reconnect is the case that actually breaks apps

A socket.io reconnect gives you a **new socket**: no rooms, and grants may have
lapsed (they live an hour). So on every `connect`, in this order:

```ts
private async resync() {
  // 1. Re-read the inbox. This is the call that RE-GRANTS every chat on the page,
  //    so it must come before any join. One request covers the whole list.
  const chats = await GET('/talk/chats');

  // 2. Re-join what the user is actually looking at (plus anything you keep hot).
  for (const id of this.joined) this.socket.emit('talk:join', { chat_id: id }, () => {});

  // 3. Catch up on the gap. Delivery is BEST-EFFORT — the socket has no durability
  //    and no queue, because the REST API is the source of truth.
  if (this.openChatId) await GET(`/talk/chats/${this.openChatId}/messages?after_id=${lastSeenId}`);
}
```

Missing an event is normal and expected. Anything you show must be reconstructible
from a read; treat the socket as a fast path, never as the record.

### Optimistic sends, and why you must dedupe

You are in the room you send into, so **your own `talk.message.new` comes back to
you** — and so do the ones from your other devices, which is a feature (your phone
sees what you sent from your laptop). The rule:

```ts
// 1. Render immediately, keyed by client_message_id.
const clientId = uuid();
store.insert({ id: null, client_message_id: clientId, body, status: 'sending' });

// 2. The ack reconciles it — this is the authoritative copy.
const msg = await talk.sendMessage({ chat_id, body, client_message_id: clientId });
store.replaceByClientId(clientId, { ...msg, status: 'sent' });

// 3. The event may arrive BEFORE, AFTER, or INSTEAD OF the ack. Dedupe on id.
socket.on('talk.message.new', ({ message }) => store.upsertById(message.id, message));
```

`upsertById` + `replaceByClientId` makes all three orderings converge. You needed
this for reconnect races anyway; sending over the socket does not add a new
requirement, it just makes an existing one unavoidable.

Retry with the **same** `client_message_id` and the server returns the same message
instead of a duplicate — so a failed send is safe to retry as-is.

### Typing: two client responsibilities

Nothing rate-limits this server-side, and nothing is stored.

```ts
// THROTTLE — at most one `true` every few seconds while the composer is active.
const onKeystroke = throttle(() => socket.emit('talk:typing', { chat_id, typing: true }), 3000);

// EXPIRE — hide the indicator ~5s after the last signal. The explicit stop is an
// optimisation, not a guarantee: a client that crashes mid-sentence never sends one.
socket.on('talk.typing.start', ({ chat_id, talk_user_id, name }) => {
  indicators.set(`${chat_id}:${talk_user_id}`, { name, until: Date.now() + 5000 });
});
```

Send `typing: false` when the composer clears or the message is sent — it makes the
indicator disappear crisply, but never rely on receiving one.

### One switch for the rest

```ts
const HANDLERS = {
  'talk.message.new':      (p) => store.upsertById(p.message.id, p.message),
  'talk.message.edited':   (p) => store.patch(p.message_id, { body: p.body, edited_at: p.edited_at }),
  'talk.message.deleted':  (p) => store.markDeleted(p.chat_id, p.message_ids),
  'talk.message.read':     (p) => store.markTicksBlue(p.chat_id, p.message_ids, p.by_talk_user_id),
  'talk.message.pinned':   (p) => store.setPinned(p.chat_id, p.message_id, true),
  'talk.message.unpinned': (p) => store.setPinned(p.chat_id, p.message_id, false),

  // No join needed — insert the row, then read the chat to earn the grant, then join.
  'talk.chat.created':     async (p) => { store.insertChat(p); await talk.openChat(p.chat_id); },
  'talk.chat.updated':     (p) => store.patchChat(p.chat_id, p),
  'talk.chat.deleted':     (p) => store.removeChat(p.chat_id),   // eviction follows; final

  'talk.member.added':     (p) => store.addMembers(p.chat_id, p.members),
  'talk.member.left':      (p) => store.removeMember(p.chat_id, p.talk_user_id),
  'talk.member.removed':   (p) => p.talk_user_id === me
                                    ? store.removeChat(p.chat_id)       // that's you — leave the screen
                                    : store.removeMember(p.chat_id, p.talk_user_id),
  'talk.member.blocked':   (p) => store.setPostingBlocked(p.chat_id, p.talk_user_id, p.blocked),

  'talk.presence':         (p) => directory.knows(p.talk_user_id) && presence.set(p),  // FILTER
};

for (const [event, handler] of Object.entries(HANDLERS)) socket.on(event, handler);
```

---

## 11. Gotchas that will bite

1. **The 401-after-30-minutes trap.** No `talk:auth.token` → your sends start
   failing while the socket still reports connected. See §3. This is the one thing
   in this document that will definitely break your app if you skip it.
2. **You receive your own events.** Room emits reach every socket in the room,
   yours included. Dedupe on `message.id`; never assume an incoming event is
   somebody else's.
3. **Join without a read fails.** Grants come from reads. `talk:join` right after
   `talk:chat.create.*` will be denied until you read the chat.
4. **Rooms do not survive a reconnect.** Re-read, then re-join, in that order (§10).
5. **Delivery is best-effort.** No durability, no queue, no replay. Reconcile with
   a read on reconnect and on foreground.
6. **`photo` is a storage key, not a URL.** Prefix with `media_path` from
   `GET /public/config`.
7. **`talk.presence` reaches your whole tenant.** Filter to people you display, or
   you will render presence dots for strangers.
8. **`talk.member.removed` arrives twice.** Compare `talk_user_id` to your own id
   before deciding what it means.
9. **Empty `realtime_url` means no socket in this environment.** Fall back to HTTP;
   do not guess a host.
10. **Ids in a payload must be real integers.** `{ chat_id: "42" }` is refused with
    a 400 — JSON-stringified ids from a URL router are the usual cause.

---

## Where this lives in the code

| what | file |
| --- | --- |
| the gateway: handshake, rooms, presence, typing, listener registration | `apps/realtime/src/main.ts` |
| inbound event → route table | `apps/realtime/src/talk-actions.ts` |
| the bridge to the API, and the ack shape | `apps/realtime/src/api-bridge.ts` |
| outbound event names and their fan-out | `apps/api/src/modules/talk/notify.ts` |
| request/response schemas (the field-level truth) | `apps/api/src/modules/talk/{schema,dto}.ts`, or `/talk/docs` |
| room grants and presence store | `packages/cache/src/index.ts` |
