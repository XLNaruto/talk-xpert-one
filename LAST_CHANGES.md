XPERTONE TALK — LAST CHANGES FOR THE FRONTEND
=============================================

Scope: every FE-visible change in the current (uncommitted) Talk changeset —
private message pins (#11b), the block redesign (#3), the per-viewer chat row
(#6/#7), the unread badge (#14), the read-frontier clamp, and the
`talk:join` / `talk.chat.created` round-trip savings.

No new endpoint and no removed endpoint. Every change below is either a new
FIELD, a new QUERY/BODY key, a new SOCKET event, or a behaviour change on an
existing call.

Legend:  [API]  request/response shape    [RT]  realtime/socket
         [BEH]  behaviour only, shape unchanged


-------------------------------------------------------------------------
A. PIN A MESSAGE FOR ME — the private bookmark (#11b)
-------------------------------------------------------------------------
There are now THREE pin features, and no two share storage or audience:
  - pin the CHAT in my own list      PUT /talk/chats/{chat_id}/pin        (old)
  - pin a MESSAGE for EVERYONE       PUT .../messages/{id}/pin  for_everyone:true
  - pin a MESSAGE for ME             PUT .../messages/{id}/pin  for_everyone:false

1. [API] PUT /talk/chats/{chat_id}/messages/{message_id}/pin — body gains
   `for_everyone` (boolean, OPTIONAL, DEFAULT **true**).
   true  = the chat-wide announcement bar everybody sees (unchanged behaviour).
   false = my own private bookmark. Nobody else's view changes, nobody else is
   notified, and it neither sets nor clears the chat-wide pin.
   Existing clients that send no flag keep pinning for everyone.
   Response is unchanged: { "pinned": boolean }.

2. [API] `expires_at` (nullable ISO datetime) works the same for both kinds:
   null pins until somebody unpins. Both kinds are IDEMPOTENT — re-pinning is
   how you extend an expiry ("pin for another week"). A lapsed pin simply stops
   appearing; no job runs.

3. [BEH] A private pin requires only MEMBERSHIP, not the right to post. You may
   pin for yourself in a group you have left, or one whose owner blocked you
   from posting. The chat-wide pin still requires postability.

4. [API] GET /talk/chats/{chat_id}/pins — query gains `scope`:
   `everyone` (DEFAULT — the chat-wide bar, i.e. the old behaviour)
   `me`       (my own private pins)
   `all`      (both, interleaved by when each pin was made)

5. [API] Each row of that list gains `for_everyone` (boolean):
   true = the chat-wide pin, false = my own private pin (in which case
   `pinned_by_talk_user_id` is me).
   Under `scope=all` a message pinned BOTH ways appears TWICE — two rows, two
   pinners, two expiries. Render/de-dupe accordingly; an unpin removes exactly
   one of them (whichever `for_everyone` you send).

6. [API] Every message object (TalkMessageResponse — thread page, search,
   `talk.message.new`, pin rows) gains `is_pinned_for_me` (boolean).
   `is_pinned` stays the CHAT-WIDE value (same for every reader).
   The two are independent in both directions: pinned for the thread and not by
   me, by me and not by the thread, both, or neither.

7. [RT] Two NEW socket events, addressed to the PINNER'S OWN subject only (their
   other devices) and never to the chat room:
     talk.message.self_pinned
     talk.message.self_unpinned
   Payload: { type, chat_id, message_id, expires_at }  (`expires_at` null on
   unpin). Do not treat these as chat events — no other participant receives them.

8. [RT] Inbound `talk:message.pin` accepts `for_everyone` too, and may now emit
   any of FOUR events: talk.message.pinned / unpinned / self_pinned /
   self_unpinned. Its ack is still { "pinned": boolean }.

9. [BEH] Pin lists remain newest-PIN-first (not newest message), and still obey
   YOUR history: a pin whose message you deleted for yourself, or which sits
   before you cleared the chat, or which was written while you had the sender
   blocked, is absent from both `items` and `total` — even for a chat-wide pin
   and even for one you set yourself.


-------------------------------------------------------------------------
B. THE DIRECT-CHAT BLOCK IS NOW A WINDOW (#3) — behaviour reversal
-------------------------------------------------------------------------
10. [BEH] **A blocked person's sends now SUCCEED.** The old flat 403
    "This message could not be delivered" is GONE. POST a message to someone who
    has blocked you and it is stored, receipted and acknowledged like any other —
    200 with the normal message body. REMOVE any FE handling that surfaced that
    error, and do not infer "you are blocked" from any send result: nothing fails
    any more, by design (the old refusal was a reliable probe for who blocked you).

11. [BEH] The OTHER direction is unchanged and still refused: if I blocked them,
    my send is 403 "Unblock this person to continue the conversation", and
    POST /talk/chats/direct with them is refused the same way. Surface this
    plainly — the user did it and can undo it.

12. [BEH] Creating a direct chat with somebody who blocked ME now SUCCEEDS
    (it used to 403). The thread is created and I may send into it.

13. [BEH] A block is an interval `[blocked_at, unblocked_at)`, and UNBLOCKING
    DOES NOT HAND BACK THE BACKLOG. Messages written while the block stood stay
    hidden from the blocker for good — in the thread page, search, the media
    gallery, the pin list, the inbox preview and every unread count. A chat
    blocked at 10:00 and unblocked at 11:30 reads as everything before 10:00
    followed by everything after 11:30, with no gap marker. Do not build a
    "load the messages I missed" affordance; there is nothing to load.
    A re-block opens a NEW episode, so the middle stays visible.

14. [RT] While a block stands, the blocker receives NO realtime event caused by
    the blocked person in that chat — talk.message.new, talk.message.edited,
    talk.message.deleted, talk.message.pinned / unpinned are all withheld
    (whole event, not just the new message). Consequence to expect: an edit to a
    PRE-block message is also withheld, so the blocker may hold stale text until
    their next read corrects it.

15. [RT] EXCEPTION — `talk:typing` is NOT suppressed. A blocker can still see
    "typing…" from somebody they blocked. Deliberate (it carries no content and
    the relay is socket-to-socket); do not report as a bug.

16. [BEH] Read receipts are NOT suppressed either. When the blocker opens the
    thread every message of the chat is stamped, suppressed ones included, so the
    blocked person's ticks turn blue for messages nobody actually read.

17. [RT] `talk.chat.created` is withheld from a blocker: if somebody they blocked
    opens a direct chat, no live row appears. The membership still exists, so the
    chat shows up as an EMPTY thread on their next full list read. Render an empty
    direct thread without error.

18. [BEH] Still NO event of any kind to the blocked person, ever, on block or
    unblock. Being blocked is meant to be indistinguishable from being ignored.

19. [API] In the blocked-users list, `blocked_at` is now the start of the CURRENT
    block episode (it used to be the row's `created_at`). Re-blocking somebody
    updates it; unblocking closes the episode instead of deleting it.

20. [BEH] `blocked: false` on PUT /talk/blocks closes the window only. It is not
    a request for the backlog — see #13.

21. [BEH] This is all the DIRECT-chat block. The GROUP block
    (PUT /talk/chats/{chat_id}/members/{talk_user_id}/block) is untouched.


-------------------------------------------------------------------------
C. THE CHAT LIST ROW IS NOW PER VIEWER (#6, #7)
-------------------------------------------------------------------------
22. [API] `last_message_at` on a chat row is now "when the last message YOU can
    still see was sent" — not the conversation's shared timestamp. It is **null**
    on a chat you deleted/cleared and in which nothing newer has arrived, and on
    a chat nobody has spoken in. Handle null (no "Invalid Date", no epoch).

23. [BEH] `last_message_at`, `last_message_preview`, `last_message_sender_*` now
    always describe the SAME message — the newest one visible to the viewer
    (not soft-deleted, not deleted-for-me, after my `cleared_at`, not inside a
    block window). Previously the preview could quote a message the viewer had
    deleted. A message deleted for everyone still occupies the slot with a null
    preview ("This message was deleted").

24. [BEH] Inbox ORDER changed accordingly: pinned chats first (unchanged), then
    by the viewer's own last visible message, nulls last. A chat you cleared now
    sorts by what is left of it, not by a message you no longer have.


-------------------------------------------------------------------------
D. UNREAD COUNTS
-------------------------------------------------------------------------
25. [BEH] `unread_count` on each row now excludes messages hidden by a block
    window — a suppressed message is unreachable, so it can no longer leave a
    badge that nothing clears.

26. [BEH] GET /talk/unread (`total_unread`) is now literally the SUM of the chat
    list's `unread_count`. The two can no longer disagree. Fixes the standing bug
    where a disbanded group's backlog kept a "99+" over an inbox whose every
    visible row read 0. If you were computing the badge client-side from the list,
    it now matches the server exactly.

27. [BEH] PUT /talk/chats/read — `upto_message_id` is CLAMPED to a message of the
    named chat. Message ids are one global sequence, so passing an id from another
    thread used to park that chat's read frontier past ids not yet allocated and
    pin it at zero unread FOREVER, unfixable from the client. Now an out-of-chat
    id can at worst mark the chat read up to its own newest message, and an id
    older than the current frontier is a no-op. Still: send an id that belongs to
    the chat, and remember `upto_message_id` applies to EVERY chat named in the
    call (omit it for the bulk "mark all read" button).


-------------------------------------------------------------------------
E. FEWER ROUND TRIPS ON THE SOCKET
-------------------------------------------------------------------------
28. [RT] `talk:join` accepts an OPT-IN flag: emit
      talk:join  { chat_id: 123, with_chat: true }
    and the ack is { ok: true, chat: <same body as GET /talk/chats/123> }, so
    subscribing and rendering a conversation is ONE round trip.
    Use it when opening a single conversation. Do NOT use it on RECONNECT, where
    you issue one join per open chat — that path should stay the pure key lookup
    it was built to be. Without the flag the ack is { ok: true } as before.

29. [RT] If that read fails the ack is still { ok: true } with NO `chat` key —
    the subscription stands and you should fall back to GET /talk/chats/{id}.
    Denial is unchanged: { ok: false, error: 'not permitted' } (re-read the chat
    over HTTP to reissue the grant, then join again).

30. [RT] `talk.chat.created` now carries the whole chat row as `chat`, built from
    the RECIPIENT'S OWN side — byte-identical to what GET /talk/chats/{id} would
    return, including `self.member_role` (`admin` for an auto-added group owner,
    `member` otherwise) and, on a direct chat, `counterpart_*` naming the CREATOR.
    Insert it straight into the list; the follow-up GET is no longer needed.
    `chat` may be **null** in a rare race (the chat was deleted in the same
    breath) — fall back to your own read, as before. The rest of the payload
    (`chat_id`, `type`, `name`, `created_by_*`) is unchanged.

31. [RT] The CREATOR of a chat no longer needs a read-back before subscribing:
    the room grant is issued at creation, so `talk:join` on the id returned by
    POST /talk/chats/direct or /talk/chats/group succeeds immediately.
    The creator still gets no `talk.chat.created` for their own creation — they
    hold the HTTP response.


-------------------------------------------------------------------------
NOTES / NON-CHANGES worth stating
-------------------------------------------------------------------------
32. Clients MUST dedupe incoming messages on `message.id`. A room emit reaches
    the actor's own sockets too, so your own send arrives back as
    `talk.message.new` (this also means your OTHER devices now see your sends).

33. No message-level "hidden because blocked" marker exists and none is coming.
    Suppressed messages are simply absent everywhere — do not draw a placeholder.

34. Socket writes and their HTTP twins return identical bodies; every shape above
    applies to both transports.

35. Unchanged: all pin/block/read endpoints keep their paths, methods and status
    codes. The only new request keys anywhere are `for_everyone` (pin body),
    `scope` (pin list query) and `with_chat` (talk:join payload).
