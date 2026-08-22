================================================================================
 TALK PUSH NOTIFICATIONS — FRONTEND INTEGRATION GUIDE
 (web + mobile)                                        last updated 2026-08-22
================================================================================

Everything a client needs to receive Talk notifications while it is closed,
backgrounded, or has no socket. Three things to build:

  1. save the device's FCM token  (POST /talk/devices)
  2. handle the push              (one handler, keyed on data.type)
  3. drop the token on logout     (mostly done for you — see §6)

The short version: every Talk event that reaches your socket ALSO reaches your
device as a push, carrying THE SAME OBJECT. If you already handle a socket
event, you can handle its push with the same function.


--------------------------------------------------------------------------------
 1. SAVE THE TOKEN
--------------------------------------------------------------------------------

  POST /talk/devices
  Authorization: Bearer <talk access token>

  {
    "token":       "<fcm registration token>",   // required
    "platform":    "ANDROID",                    // required — see below
    "device_name": "Pixel 8",                    // optional, support only
    "app_version": "3.4.1"                       // optional
  }

  200 →
  {
    "id": 41,
    "platform": "ANDROID",
    "device_name": "Pixel 8",
    "app_version": "3.4.1",
    "last_used_at": "2026-08-22T09:14:03.221Z",
    "created_at":   "2026-08-22T09:14:03.221Z"
  }

WHEN TO CALL IT
  - on every app launch, as soon as Firebase hands you a token;
  - again on every token rotation (`onTokenRefresh` / `onTokenRefreshed`);
  - again after a fresh login, because the token belongs to whoever is signed in.

  It is an UPSERT. Calling it repeatedly with the same token is the NORMAL path,
  not an error — it just refreshes the metadata and `last_used_at`. Do not try to
  cache "already registered" and skip it; the call is how the server knows the
  device is still alive.

`platform` IS A SLOT, NOT A LABEL — READ THIS
  Allowed: ANDROID | IOS | MAC | WINDOWS | LINUX | WEB   (uppercase, exact)

  Talk keeps ONE live session per operating system, and now one live DEVICE per
  operating system to match. Saving an ANDROID token retires whatever token
  previously held your Android slot, and leaves your iPhone, Mac and browser
  registrations completely alone.

  So: send the SAME platform string you sent to POST /talk/auth/login. If you
  guess, or hardcode WEB in a mobile webview, you will silently evict a device
  the user is actively holding. There is no default for exactly this reason.

  The token is also unique product-wide: if this registration token was last
  seen under a different participant (someone reinstalled the app on this
  handset) it MOVES to you, and the previous holder stops receiving it.

THERE IS NO `talk_user_id` IN THE BODY
  Your bearer token names the only participant a device can be registered for.
  Don't look for the field; it was left out on purpose.

WHAT NOT TO DO
  - Don't register before you have a Talk token — this route is authenticated.
  - Don't send a lowercase platform ("android"). It is rejected (400).
  - Don't reuse the /employee notification device routes for chat. Different
    principal, different registry, and a chat push will never arrive there.


--------------------------------------------------------------------------------
 2. THE PUSH PAYLOAD  (this is the important section)
--------------------------------------------------------------------------------

Every push carries BOTH halves of an FCM message:

  notification { title, body }   what the OS/browser displays
  data         { ... }           the whole Talk event, for your code

`data` is the same object your socket handler already receives — event envelope
included. FCM flattens `data` to a string map, so it is encoded like this:

  - every TOP-LEVEL key of the event, as a string
      data.type      = "talk.message.new"
      data.chat_id   = "7"                 <-- NOTE: string, not number
  - any nested object/array as its JSON
      data.message   = '{"id":9,"body":"Hi",...}'
  - plus the WHOLE event as one JSON string
      data.payload   = '{"type":"talk.message.new","chat_id":7,"message":{...}}'

TWO WAYS TO CONSUME IT — pick one, don't mix:

  (a) recommended — parse once, reuse your socket handler:

        const event = JSON.parse(data.payload);   // identical to socket payload
        handleTalkEvent(event);                   // the function you already have

      `data.payload` is byte-identical to what the socket published: real
      numbers, real nested objects, no stringification. This is why it exists.

  (b) cheap checks without parsing — read the flat fields:

        if (data.type === 'talk.message.new') openChat(Number(data.chat_id));

      Remember every value here is a STRING. `data.chat_id` is "7". Coerce it.

WEB vs MOBILE
  - WEB (service worker / browser): you generally want `notification` for the
    banner and `data.payload` to update your in-memory store.
  - MOBILE: use `data` for everything and let the OS draw `notification`. On
    Android, a data+notification message is delivered to `onMessageReceived`
    only in the foreground; backgrounded, the OS draws the notification and your
    data arrives in the launch intent. Read `data.payload` from the intent
    extras on tap.
  - iOS: enable background/remote notifications if you want the silent events
    (§3) to reach you while backgrounded.


--------------------------------------------------------------------------------
 3. LOUD vs SILENT — which pushes have a banner
--------------------------------------------------------------------------------

EVERY Talk event is pushed. Not every one interrupts the user.

LOUD (has notification.title + notification.body):

  talk.message.new       a message — AND every membership sentence, because
                         "Minato added Draco" is stored as a system message and
                         arrives through this same event, already rendered
  talk.chat.created      somebody opened a direct chat with you, or added you to
                         a group. For a direct chat this is the ONLY signal
  talk.message.pinned    the announcement bar changed

SILENT (data only, notification.body is null — do NOT show a banner for these):

  talk.message.edited          talk.member.added
  talk.message.deleted         talk.member.left
  talk.message.read            talk.member.removed
  talk.message.unpinned        talk.member.blocked
  talk.message.self_pinned     talk.member.role_changed
  talk.message.self_unpinned   talk.chat.updated
  talk.unread.updated          talk.chat.deleted

  These exist so a backgrounded client can stay correct — update the thread,
  redraw the member list, set the app-icon badge — without buzzing. In
  particular `talk.unread.updated` is what you set the iOS/Android app badge
  from; it carries the four counts whole (all / direct / group), already
  computed server-side, so never increment a counter of your own.

  How to tell them apart in code: `notification` is absent or its body is null.
  Don't hardcode the list above — branch on the presence of a body.

NEVER PUSHED
  talk.typing.start / talk.typing.stop — socket only. They fire per keystroke
  burst and are worthless a second later. Don't wait for them.

WHAT YOU WILL NOT GET A PUSH FOR
  - your OWN actions. The sender/actor is excluded, so you never get notified
    of your own message, pin or edit. Your OTHER devices get it over the socket.
      EXCEPTION: the addressed private events are deliberately sent TO you —
      talk.unread.updated, talk.message.self_pinned/self_unpinned,
      talk.member.removed (you were removed) and talk.chat.created. That is how
      your phone and your tablet stay in agreement about your own state.
  - anything from someone you have BLOCKED. Suppression carries over from the
    socket, so the push is withheld too.
  - chats you have left or been removed from.


--------------------------------------------------------------------------------
 4. DEDUPE — required, not optional
--------------------------------------------------------------------------------

A connected client will receive the SAME event twice: once on the socket, once
as a push. This is by design (the push is the offline path and cannot know
whether your socket happened to be up).

Dedupe on the event's own identity, in this order of preference:

  talk.message.new       message.id
  talk.message.*         message_id / message_ids
  talk.chat.*            chat_id + type
  everything else        (type, chat_id) + your own last-applied timestamp

You already need this for socket reconnects — the same keyed cache covers both.
Do NOT dedupe on push message id; FCM's ids differ from the socket's.

Also: the REST API is the source of truth, always. Push and socket delivery are
both best-effort. On resume, refetch — GET /talk/chats, GET /talk/chats/:id/
messages?after_id=…, GET /talk/chats/unread-summary — and treat pushes as a
nudge to do that, never as the only copy of anything.

STALENESS: the payload is a snapshot taken when the event fired. A message
withdrawn a second later still pushes its text; the tombstone follows as its own
`talk.message.deleted`. Apply events in arrival order and let the later one win.


--------------------------------------------------------------------------------
 5. DEEP-LINKING ON TAP
--------------------------------------------------------------------------------

  const event = JSON.parse(data.payload);

  switch (event.type) {
    case 'talk.message.new':
      openChat(event.chat_id, { scrollTo: event.message.id });   break;
    case 'talk.chat.created':
      // event.chat is the WHOLE chat list row, drawn from YOUR side —
      // insert it straight into your list, no follow-up GET needed
      insertChat(event.chat); openChat(event.chat_id);            break;
    case 'talk.message.pinned':
      openChat(event.chat_id, { showPinBar: true });              break;
    default:
      openChat(event.chat_id);                                    break;
  }

`event.chat_id` is present on every chat-scoped event. It is absent on exactly
one: `talk.unread.updated`, which is an account-wide roll-up and deliberately
not filed under any conversation.


--------------------------------------------------------------------------------
 6. LOGOUT AND CLEANUP
--------------------------------------------------------------------------------

  POST /talk/auth/logout  ALREADY drops your push registration.
  - default: this platform's device only (your other OSes keep receiving)
  - all_devices: true: every device

  So on a normal logout you do NOT need to call DELETE /talk/devices. It is done
  for you, because a handset that was only signed out would otherwise keep
  buzzing with a conversation it can no longer open.

  DELETE /talk/devices  { "token": "..." }   → { "removed": true }

  Call this when:
  - you rotate your own token and want the old one gone immediately;
  - you clear local state without hitting /auth/logout.

  Scoped to your own devices — someone else's token answers `removed: false`
  rather than deleting their registration. Idempotent; a retried logout settles.

  You do NOT need to call it when Firebase says a token is dead. The server
  prunes those itself, because that verdict arrives at the sender.

  GET /talk/devices → { "items": [ ...same shape as the POST response... ] }
  The registered handsets, most recently active first. The FCM token is NEVER
  returned — it is a push credential, and the only client that legitimately has
  one is the device that made it.

  Worth reading beside GET /talk/auth/sessions: a SESSION is a live sign-in on
  an OS, a DEVICE is somewhere a notification can land. The platform slot keeps
  them in step — if they disagree, that's a bug, please report it.


--------------------------------------------------------------------------------
 7. WORKED EXAMPLE — `talk.message.new` in a group
--------------------------------------------------------------------------------

  notification:
    title: "Payroll"                 <-- group name (direct chat: sender's name)
    body:  "Minato: Hi"              <-- direct chat: just "Hi"

  data:
    type:      "talk.message.new"
    chat_id:   "7"
    message:   '{"id":9,"chat_id":7,"sender_talk_user_id":1,
                 "sender_name":"Minato","type":"text","body":"Hi", ... }'
    payload:   '{"type":"talk.message.new","chat_id":7,"message":{...}}'

  A media message with no caption previews as its kind:
    "📷 Photo" | "🎥 Video" | "🎤 Voice message" | "📄 Document"

  A system message is NOT prefixed with a sender — the sentence already names
  everyone in it:
    title: "Payroll"   body: "Minato added Draco"


--------------------------------------------------------------------------------
 8. CHECKLIST
--------------------------------------------------------------------------------

  [ ] POST /talk/devices on launch, on token refresh, and after login
  [ ] platform string matches the one sent to /talk/auth/login, uppercase
  [ ] one handler keyed on data.type, fed from JSON.parse(data.payload)
  [ ] coerce data.chat_id etc. — flat data fields are STRINGS
  [ ] no banner when notification.body is null (silent sync events)
  [ ] app-icon badge driven by talk.unread.updated, never incremented locally
  [ ] dedupe socket vs push on message.id / message_id
  [ ] refetch from REST on resume; treat push as a nudge
  [ ] do not expect talk.typing.* as a push
  [ ] no DELETE /talk/devices needed on a normal /auth/logout

--------------------------------------------------------------------------------
 TROUBLESHOOTING
--------------------------------------------------------------------------------

 Nothing arrives at all
   - Is the token saved? GET /talk/devices should list this handset.
   - Did another sign-in on the SAME platform retire this device? Check that
     your platform string is right; two clients claiming ANDROID will fight over
     one slot and the loser goes quiet.
   - Backend: with USE_STUB_PUSH set (or no Firebase service account) the worker
     logs instead of sending. With USE_STUB_QUEUE set, nothing is enqueued at
     all — the socket still works. Both are normal locally.

 I get pushes for my own messages
   - You shouldn't. Report it with the event's `type` and the actor id.

 The banner is empty / shows raw JSON
   - You are rendering a SILENT event. Branch on notification.body being null.

 Numbers compare wrong
   - `data.chat_id` is the string "7". Use data.payload, or coerce.
