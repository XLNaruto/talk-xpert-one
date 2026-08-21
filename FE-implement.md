TALK — UNREAD BADGES ON THE CHAT-LIST FILTER TABS
=================================================
Date: 2026-08-20
Scope: Talk chat product only (`/talk` REST audience + the Socket.IO gateway).
       Nothing outside Talk changed. Nothing existing broke — this is additive.

WHAT YOU ASKED FOR
  A number on each of the four chat-list tabs — All / Unread / Direct / Groups —
  that goes UP the moment a message arrives and DOWN the moment the user reads,
  without polling and without you counting anything yourself.

WHAT YOU GET
  One body, two transports:
    * `GET /talk/chats/unread-summary`  — the snapshot, on screen mount.
    * `talk.unread.updated` (socket)    — the same body, pushed whenever the
                                          numbers move.
  Identical fields, identical shape, one parser. Render straight from it.

  1. The payload, and which number goes on which tab
  2. The event — when it fires and who receives it
  3. What you must do
  4. Rules and edge cases (read these — they prevent the classic badge bugs)
  5. Worked example
  6. Checklist / not changed

--------------------------------------------------------------------------------
1. THE PAYLOAD
--------------------------------------------------------------------------------
  GET /talk/chats/unread-summary        (Talk access token, as every /talk route)
  200:

  {
    "all":    { "chats": 3, "messages": 12 },
    "unread": { "chats": 3, "messages": 12 },
    "direct": { "chats": 2, "messages": 5  },
    "groups": { "chats": 1, "messages": 7  },
    "total_unread": 12
  }

  The socket event is the SAME object with the envelope's `type` on it:

  {
    "type": "talk.unread.updated",
    "all":    { "chats": 3, "messages": 12 },
    "unread": { "chats": 3, "messages": 12 },
    "direct": { "chats": 2, "messages": 5  },
    "groups": { "chats": 1, "messages": 7  },
    "total_unread": 12
  }

  TWO COUNTS PER BUCKET, and they answer different questions:

    `chats`    how many CONVERSATIONS have something unread in them.
               This is the number that belongs on a filter tab.
    `messages` how many unread MESSAGES those conversations hold between them.
               This is the app / OS / launcher badge number.

  Neither is derivable from the other, so both travel together. Pick one per
  surface and stay consistent:

    TAB           FIELD                          TYPICAL USE
    ------------  -----------------------------  --------------------------------
    All           all.chats                      tab pill
    Unread        unread.chats                   tab pill
    Direct        direct.chats                   tab pill
    Groups        groups.chats                   tab pill
    app icon      total_unread (= all.messages)  OS badge / tab title "(12)"

  `unread` IS `all`, repeated on purpose. The Unread tab filters to exactly the
  chats that have unread, so it cannot be a different number. It is in the
  payload so you can map tab -> key with no special case:

    const KEY = { all: 'all', unread: 'unread', direct: 'direct', groups: 'groups' };
    const badge = summary[KEY[activeTab]].chats;

  NOTE the key is `groups` (plural, matching the tab) while the chat's own kind
  on every other Talk payload is `group` (singular). Do not index this object
  with `chat.type`.

  `total_unread` is `all.messages` under its own name. It was the whole of this
  response before this change, so an existing caller keeps working untouched.

--------------------------------------------------------------------------------
2. THE EVENT
--------------------------------------------------------------------------------
  socket.on('talk.unread.updated', (s) => setSummary(s));

  ADDRESSED, NOT BROADCAST. It is delivered to the one participant whose badges
  moved, on every device they have signed in. A badge is derived from what THAT
  person has read, so it is never emitted to a chat room and you will never
  receive somebody else's numbers.

  NO `chat_id`. This is an account-wide roll-up, deliberately not stamped with
  whichever conversation triggered it — do not file it under a chat. For the
  per-row badge keep using `unread_count` on the chat-list row.

  WHEN IT FIRES

    UP    a message is sent or forwarded into a chat you are in
    UP    a system line is posted in a group you are in ("X was added",
          "X left", group renamed) — those count as unread, same as a sentence
    DOWN  you mark chats read (one, or fifty in one call)
    DOWN  a sender withdraws a message you had not read (delete for everyone)
    DOWN  you delete a message for yourself
    DOWN  you delete (hide) a chat from your list
    DOWN  you leave a group, are removed from one, or the owner disbands it

  It fires for the WRITE, whichever transport made it — the HTTP route and the
  inbound socket event (`talk:message.send`, `talk:message.read`, …) run the
  same code, so marking read over the socket moves the badge exactly as the
  REST call does.

  Both directions arrive as a full recomputed object. There is no delta event
  and no "invalidate" event.

--------------------------------------------------------------------------------
3. WHAT YOU MUST DO
--------------------------------------------------------------------------------
  * On the chat-list screen mounting (and on socket reconnect), call
    `GET /talk/chats/unread-summary` once and store the object.

  * Bind `talk.unread.updated` and REPLACE the stored object wholesale. Do not
    merge, do not add, do not compare with what you had — the server sends the
    truth, every time.

  * Read the tab pills off that one object. Do NOT compute them by summing
    `unread_count` over the chat-list rows you happen to have loaded: the list
    is PAGED (30 rows), so that sum is only ever the first page's worth, and it
    is wrong the moment the user has 31 chats.

  * Keep the per-row badge on `unread_count` from `GET /talk/chats` as you do
    today. The two are computed from the same definition and cannot disagree,
    so the row and the tab always tell the same story.

  * Optimistic read: you may zero a row's `unread_count` the instant the user
    opens a thread. The tab pill will correct itself when
    `talk.unread.updated` lands a moment later. If you also want the pill to
    drop instantly, decrement your local copy — but let the next event
    overwrite it rather than treating your arithmetic as authoritative.

  * Do not poll. If you want a safety net, refetch the snapshot on reconnect
    and on app foreground, not on a timer.

  The tab FILTERS themselves are unchanged and still server-side:
    GET /talk/chats                       -> All
    GET /talk/chats?unread_only=true      -> Unread
    GET /talk/chats?type=direct           -> Direct
    GET /talk/chats?type=group            -> Groups

--------------------------------------------------------------------------------
4. RULES AND EDGE CASES
--------------------------------------------------------------------------------
  The counts use the chat list's OWN definition of unread. Everything below
  follows from that, and each line is a badge bug that cannot happen:

  * YOUR OWN MESSAGES NEVER COUNT. Sending does not raise your badge — and the
    event still reaches your OTHER devices for that send, carrying unchanged
    numbers. Rendering it is a no-op; do not treat "an event arrived" as "a
    number went up".

  * ONLY CHATS THE LIST SHOWS ARE COUNTED. A group the owner disbanded, a chat
    you hid, one you left — none of them contributes. There is no badge over an
    inbox where every visible row reads 0.

  * A GROUP YOU WERE JUST ADDED TO COUNTS 0. Pre-join history is closed to you
    (see `changes.txt` #6), so a year-old group appears with an empty pill, not
    with 400 unread you cannot clear.

  * MESSAGES YOU HID (delete for me) AND EVERYTHING BEFORE A CHAT YOU CLEARED
    are excluded.

  * A CHAT WITH 0 UNREAD IS IN NEITHER COUNT. `chats` counts rows that have a
    badge, not rows.

  * BLOCKED (direct chats): messages written while you had the other person
    blocked never count, and unblocking does not deliver them. You will not
    receive an event for those sends at all.

  * SYSTEM LINES COUNT. "X was added to the group" raises the group badge by 1
    for everyone in it. That is intended — something did happen — and it clears
    like any other message. Do not filter system messages out of your mental
    model of the number.

  * PINNED IS ORTHOGONAL. There is no pinned bucket; a pinned chat's unread is
    inside `all` and inside `direct`/`groups` by its kind, exactly as its row
    is.

  * BEST EFFORT, LIKE EVERY TALK EVENT. A push you missed (socket down, app
    backgrounded) is corrected by the next one, by the snapshot on reconnect,
    or by the chat list itself. Never let a badge be the only copy of state you
    cannot refetch.

--------------------------------------------------------------------------------
5. WORKED EXAMPLE
--------------------------------------------------------------------------------
  State: 1 direct chat with 5 unread, 1 group with 7 unread, everything else
  read.

    { all: {chats:2, messages:12}, unread: {chats:2, messages:12},
      direct: {chats:1, messages:5}, groups: {chats:1, messages:7},
      total_unread: 12 }

    All 2   Unread 2   Direct 1   Groups 1        app badge 12

  A colleague sends 1 message into a SECOND group. `talk.unread.updated` lands:

    { all: {chats:3, messages:13}, unread: {chats:3, messages:13},
      direct: {chats:1, messages:5}, groups: {chats:2, messages:8},
      total_unread: 13 }

    All 3   Unread 3   Direct 1   Groups 2        app badge 13

  The user opens the direct chat; you call `POST /talk/chats/read`. Two events
  arrive: `talk.message.read` (the sender's ticks turn blue — unrelated to the
  badge) and `talk.unread.updated`:

    { all: {chats:2, messages:8}, unread: {chats:2, messages:8},
      direct: {chats:0, messages:0}, groups: {chats:2, messages:8},
      total_unread: 8 }

    All 2   Unread 2   Direct 0   Groups 2        app badge 8

  Hide the Direct pill on 0 (or render a dash) — the server sends a real zero,
  it does not omit the bucket.

--------------------------------------------------------------------------------
6. CHECKLIST
--------------------------------------------------------------------------------
  [ ] Fetch `GET /talk/chats/unread-summary` on chat-list mount and on
      reconnect / foreground
  [ ] Bind `talk.unread.updated` and REPLACE the stored summary wholesale
  [ ] Tab pills from `<bucket>.chats`; app / OS badge from `total_unread`
  [ ] Index with the tab key (`groups`, plural) — never with `chat.type`
  [ ] Stop summing `unread_count` across loaded rows for the tab pills
  [ ] Keep the per-row badge on the row's own `unread_count`
  [ ] Zero on 0 is a real value: render "no pill", not "unknown"
  [ ] No polling timer

--------------------------------------------------------------------------------
NOT CHANGED
--------------------------------------------------------------------------------
  * `total_unread` on `GET /talk/chats/unread-summary` — same field, same
    meaning. An existing caller needs no change at all.
  * `unread_count` on every chat-list row, and the definition behind it.
  * The four filter queries (`unread_only`, `type=direct`, `type=group`).
  * Every other REST path, request shape and status code.
  * Every other socket event: `talk.message.new`, `talk.message.read`,
    `talk.message.edited`, `talk.message.deleted`, `talk.chat.created`,
    `talk.member.*`, the pin events, the typing pair, `talk.presence`.
  * Auth, tokens, sessions, the one-session-per-platform rule.
