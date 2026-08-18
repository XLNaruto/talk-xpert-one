/**
 * Shapes shared by every Talk endpoint.
 *
 * There is NO envelope. `GET /talk/chats` answers `{ items, total }` at the top
 * level, `POST .../messages` answers the message object itself. Nothing is
 * wrapped in `{ data }`, so nothing here unwraps one.
 */

/** Every Talk id is an integer. Never mix a `talk_user_id` with a user id. */
export type Id = number

/**
 * An offset-paged list: chats, members, media, search results, blocks.
 *
 * Offset paging is correct for these because the row set is stable while you
 * read it. Message history is NOT one of them — see {@link MessagePage}.
 */
export interface ListPage<T> {
  items: T[]
  total: number
}

/**
 * A page of message history.
 *
 * Messages page by **message id**, not by offset: new rows arrive constantly, so
 * an offset would skip or repeat between requests. `before_id` walks up through
 * history; `after_id` replays the gap after a reconnect. There is no `total` and
 * no cursor token — the ids in the page ARE the cursor.
 */
export interface MessagePage<T> {
  items: T[]
  /** Oldest id in this page — pass as `before_id` for the next page up. */
  oldestId: Id | null
  /** Newest id in this page — pass as `after_id` for the reconnect catch-up. */
  newestId: Id | null
  /** A full page came back, so there is probably more above. */
  hasMore: boolean
}

/** Store maps are JSON-round-tripped, so their keys are always strings. */
export function keyOf(id: Id): string {
  return String(id)
}
