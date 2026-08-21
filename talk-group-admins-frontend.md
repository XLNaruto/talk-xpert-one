# Talk — group admins and owner succession: what the frontend must change

A group's authority used to sit entirely with its creator. It is now shareable:
the creator can appoint **admins**, who hold the same powers over the membership,
and the creator can finally **leave** — the group is handed on rather than left
ungoverned.

**Nothing on the wire breaks.** No field was removed, renamed or re-typed. Every
change is additive: one new endpoint, one new socket event pair, three new
`system_event` codes, and one refusal that no longer happens.

What DOES change is **who your UI must offer controls to**. Two screens gate
member actions on `member_role === 'owner'` today, and that check is now wrong in
both directions — it hides the controls from an admin who has them, and it draws a
"leave" refusal that no longer exists.

Jump to [what the frontend must change](#what-the-frontend-must-change).

---

## The model, in one paragraph

`member_role` is `owner` | `admin` | `member`, as before. **`owner` and `admin`
now hold exactly the same powers over the membership** — add, remove, mute,
appoint further admins. The single difference between them is the _target_: **the
`owner` row is untouchable.** No admin (and no owner, on their own row) may
remove, mute or demote the creator. That is the rule that makes appointing an
admin delegation rather than a gamble — Minato can promote Goku, and Goku can
never take the group from Minato.

Two powers stay owner-only, unchanged: **rename/edit** the group
(`PATCH /talk/chats/{chat_id}`) and **disband** it
(`DELETE /talk/chats/{chat_id}`).

`owner` is exactly one live member of a group at a time. It is **never granted by
request** — the promote endpoint refuses the value. It moves only by succession,
below.

---

## What changed on the API

### 1. New — promote and demote

```
PUT /talk/chats/{chat_id}/members/{talk_user_id}/role
     body:      { "member_role": "admin" }      // or "member"
     response:  { "member_role": "admin" }
```

Caller must be the group's `owner` **or** an `admin`. `member_role` accepts only
`admin` and `member`; `owner` is not a valid value (422 from the schema).

**Idempotent** — setting the role somebody already holds answers 200, writes
nothing and announces nothing, so two admins tapping the same button do not put
two identical lines in the thread. Do not disable the button optimistically on
the assumption a second tap is harmful.

Refusals, with the exact `message` your error toast will show:

| status | when                           | message                                          |
| ------ | ------------------------------ | ------------------------------------------------ |
| 403    | caller is a plain `member`     | `Only the group creator or an admin can do this` |
| 403    | caller left / was removed      | `You are no longer in this group`                |
| 403    | target is the `owner`          | `The group creator's role cannot be changed`     |
| 400    | target is yourself             | `You cannot change your own role`                |
| 400    | target left or was removed     | `That person is no longer in this group`         |
| 404    | target was never in this group | `That person is not in this group`               |
| 400    | chat is a direct chat          | `This operation applies to group chats only`     |

The same operation is available on the socket as **`talk:member.role`** — same
flat snake_case payload (`chat_id`, `talk_user_id`, `member_role`), same ack body,
status 200. Use whichever transport the screen already uses for
`talk:member.block`.

### 2. Add / remove / mute now accept an admin, not just the owner

No signature change. `POST /talk/chats/{chat_id}/members`,
`DELETE /talk/chats/{chat_id}/members/{talk_user_id}` and
`PUT /talk/chats/{chat_id}/members/{talk_user_id}/block` used to answer 403 to
anybody but the creator. They now accept any `admin` too.

Two refusals on those endpoints changed wording, both for the better — they now
say what to do instead:

| endpoint | before                                                          | after                                                                  |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| remove   | `The group creator cannot be removed` (when aiming at yourself) | `You cannot remove yourself. Leave the group instead.`                 |
| remove   | —                                                               | `The group creator cannot be removed` (aiming at the owner, by anyone) |
| block    | `The group creator cannot block themselves`                     | `You cannot mute yourself`                                             |
| block    | —                                                               | `The group creator cannot be muted`                                    |

If you match on message strings anywhere, these are the ones that moved. Prefer
gating the control so the request is never made — see below.

### 3. The owner can leave, and the group is handed on

`POST /talk/chats/{chat_id}/leave` used to answer **400 `The group creator cannot
leave. Delete the group instead.`** That refusal is gone. The owner's leave now
succeeds and, in the same operation, **succession** hands the role to:

1. the longest-standing remaining **admin**, or
2. failing that, the longest-standing remaining **member** — which in a group
   with a single admin (the ordinary case) is **the first person added to the
   group**.

The thread gets two lines, in this order: `member_left`, then
`owner_transferred`. Every remaining client also receives
`talk.member.role_changed` naming the heir with `member_role: "owner"`, so the
member list and its controls redraw with no re-read.

**The last member out leaves the group owner-less.** That is allowed and is not
an error: nothing is promoted, the group is not disbanded, and the history stays
readable for everybody who was in it. Such a group cannot be renamed or
disbanded by anyone — there is nobody left to do it. You need no UI for this;
just do not assume a group always has an `owner` in its member list.

### 4. Three new `system_event` codes

`member_promoted`, `member_demoted`, `owner_transferred` — on `GET
/talk/chats/{chat_id}/messages`, in the `talk.message.new` socket event, and as
`last_message_system_event` on a chat-list row.

**If you render system lines from the server's `body`, you need no change** —
`body` is the finished sentence, as always:

- `Minato made Goku an admin`
- `Minato removed Goku as an admin`
- `Goku is now the group admin after Minato left`

If you render your own sentences from `system_event` + `system_data`, add three
cases. Operands are the usual snapshot shape — `talk_user_id` / `name` / `photo`
for the subject, `by_talk_user_id` / `by_name` / `by_photo` for the actor. **On
`owner_transferred`, `by_*` is the person who LEFT, not a promoter** — nobody
promoted anyone. Anything you do not recognise still falls back to `This chat was
updated`, so an un-updated client degrades rather than breaks.

### 5. New socket event — `talk.member.role_changed`

Emitted to the chat room. One event for all three cases; `previous_member_role`
is what tells them apart without a lookup.

```jsonc
{
  "type": "talk.member.role_changed",
  "chat_id": 42,
  "talk_user_id": 2, // whose role changed
  "name": "Goku",
  "photo": "acct/1/…jpg",
  "member_role": "admin", // what they hold NOW
  "previous_member_role": "member",
  "by_talk_user_id": 1, // who did it — or, on succession, who LEFT
  "by_name": "Minato",
  "by_photo": "acct/1/…jpg",
}
```

`member_role: "owner"` on this event means succession. The promoted member is
already in the room, so — unlike `talk.member.added` — there is no separate
personal admission event to handle.

---

## What the frontend must change

### REQUIRED — the member-row action menu (the ⋮ in your screenshot)

This is the screen the whole change is for. It currently shows **Mute** and
**Remove from group** only when the viewer is the `owner`. Three corrections:

```ts
// before
const canManage = chat.self.member_role === 'owner';

// after
const canManage = chat.self.member_role === 'owner' || chat.self.member_role === 'admin';
```

1. **Show the menu to admins.** Gate on `owner || admin`, not `owner`.
2. **Draw NO menu on the `owner`'s row** — not for admins, and not for the owner
   themselves. Every item in it (mute, remove, demote) is refused against the
   creator, so a menu there is three buttons that can only produce toasts. In
   your screenshot that is the Minato row, which already renders no menu because
   it is `You`; it must now render none because it is the `owner`, which is a
   different condition and the one that holds for Goku's view of it.
3. **Add the promote/demote item**, driven by the target's own `member_role`:
   - target is `member` → **"Make admin"** → `PUT …/role { "member_role": "admin" }`
   - target is `admin` → **"Remove as admin"** → `PUT …/role { "member_role": "member" }`
   - target is `owner` → nothing (see 2)

Suggested copy under the item, matching the Mute pattern in the screenshot:
_"They can add, remove and mute members"_.

Never render any of these against your own row — `talk_user_id ===
self.talk_user_id` refuses on all three verbs.

### REQUIRED — the member-list role badge

The screenshot shows one `Admin` chip, on the `owner`. Now that the two are
distinct and both appear in one list, one chip cannot carry both:

| `member_role` | suggested chip         |
| ------------- | ---------------------- |
| `owner`       | `Owner` (or `Creator`) |
| `admin`       | `Admin`                |
| `member`      | none                   |

If you would rather keep one word on screen, keep `Admin` for both and rely on
rule 2 above to hide the actions on the owner's row — but then the group cannot
see who made it, and "why does Goku's menu not work on Minato" becomes a support
question.

### REQUIRED — the group-info "Leave group" control

Any copy or disabled state along the lines of _"the group creator cannot
leave — delete the group instead"_ is now wrong and must go. The owner may leave.

Worth a confirmation dialog that says where the group goes, because it is not
obvious and it is not reversible: _"You'll no longer be an admin of this group.
{name} will become the new admin."_ The name is resolvable client-side from the
member list with the same rule the server uses — first `admin` by join order,
else first `member` by join order — or you can simply say _"Another member will
become the admin"_ and let the `owner_transferred` line confirm it.

### REQUIRED — do not gate rename/disband on `admin`

Wherever the code moves from `member_role === 'owner'` to `owner || admin`, check
each site: **rename/edit and disband stay owner-only.** An admin shown a Delete
Group button gets `Only the group creator can do this`. The two edit surfaces are
group name/description/avatar and the disband action.

### RECOMMENDED — handle `talk.member.role_changed` live

Without it, a promoted member sees no new controls and a demoted one keeps stale
ones until they reload. On receipt: patch that member's `member_role` in the
member list, and — when `talk_user_id === self.talk_user_id` — patch
`chat.self.member_role` too, which is what every `canManage` check above reads.
`member_role: "owner"` is succession; treat it identically.

The `talk.message.new` carrying the system line arrives alongside it, so the
thread updates on its own.

### NO CHANGE NEEDED

- **`chat.self.member_role`** — same field, same three values. Only what you
  branch on it changes.
- **System-message rendering from `body`** — the server still renders the
  sentence.
- **`is_blocked` / mute behaviour** — unchanged; a muted member still reads.
- **Group creation** — unchanged. The creator is still `owner`, and an account
  owner with "auto add me in group" is still added as `admin`. That flag was
  already the only source of `admin` rows, which is why the role existed in the
  contract while granting nothing; those users now genuinely hold the powers.
- **`talk.member.added` / `.left` / `.removed` / `.blocked`** — unchanged
  payloads.

---

## Not built, for the record

**An admin cannot resign.** Demoting yourself is refused (`You cannot change your
own role`), so the only way out of the role is another admin demoting you, or
leaving the group. If a "Step down as admin" item is wanted on the FE, say so —
it is a small addition to the same endpoint, but it is deliberately not there
today because resigning and demoting somebody else are different decisions and
should not share one button.

**Nothing re-appoints an admin who comes back.** Somebody re-added after leaving
returns as a plain `member`, whatever they were before. Their read frontier and
cleared history survive; their authority does not.
