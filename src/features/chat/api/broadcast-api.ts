import { apiClient } from '@/lib/api-client'
import { ENDPOINTS } from '@/lib/endpoints'
import { ATTACHMENT_CONTENT_TYPES, uploadFile } from '@/lib/uploads'
import { rememberPeople } from '@/stores/talk-directory-store'
import type { Id, ListPage } from '@/types/api'
import {
  BROADCAST_LIST_PAGE_SIZE,
  BROADCAST_PAGE_SIZE,
  BROADCAST_SEND_TIMEOUT_MS,
  SOCKET_ACTIONS,
} from '../constants'
import {
  toBroadcast,
  toBroadcastList,
  toBroadcastListDetail,
  toBroadcastReport,
  type BroadcastDto,
  type BroadcastListDto,
  type BroadcastReportDto,
} from '../lib/chat-mappers'
import { peopleInBroadcastList, peopleInBroadcastReport } from '../lib/talk-directory'
import type {
  Broadcast,
  BroadcastDeliveryStatus,
  BroadcastList,
  BroadcastListDetail,
  BroadcastReport,
  OutgoingMedia,
  SendBroadcastInput,
} from '../types'
import { write } from './chat-api'

/**
 * Broadcast lists — the only place axios is called for them. Hooks in
 * `use-broadcasts.ts` wrap these.
 *
 * A list is NOT a chat: it never appears in `GET /talk/chats`, its recipients
 * cannot tell it exists, and each send lands as an ordinary message in every
 * recipient's 1:1 chat with me. Those copies arrive through the normal
 * `talk.message.new`, so nothing here touches the chat list.
 */

/** Drop undefined so axios does not serialise `?before_id=undefined`. */
function params(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined))
}

function detail(dto: BroadcastListDto): BroadcastListDetail {
  const list = toBroadcastListDetail(dto)
  rememberPeople(peopleInBroadcastList(list))
  return list
}

/** The Broadcast Lists screen: last-sent first, never-sent after, newest first. */
export async function fetchBroadcastLists(
  { limit = BROADCAST_LIST_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ListPage<BroadcastList>> {
  const res = await apiClient.get<{ items: BroadcastListDto[]; total: number }>(
    ENDPOINTS.broadcastLists.list,
    { params: { limit, offset } },
  )
  return { items: (res.data.items ?? []).map(toBroadcastList), total: res.data.total ?? 0 }
}

/** One list with everyone on it — the info screen and the edit picker's start. */
export async function fetchBroadcastList(listId: Id): Promise<BroadcastListDetail> {
  const res = await apiClient.get<BroadcastListDto>(ENDPOINTS.broadcastLists.detail(listId))
  return detail(res.data)
}

/**
 * 2 to 256 DIFFERENT people, all within my reach. Nothing is sent and nobody is
 * told — a list is invisible to the people on it.
 */
export async function createBroadcastList(input: {
  name: string | null
  talkUserIds: Id[]
}): Promise<BroadcastListDetail> {
  const body = { name: input.name?.trim() || undefined, talk_user_ids: input.talkUserIds }
  return write<BroadcastListDto, BroadcastListDetail>(
    SOCKET_ACTIONS.broadcastListCreate,
    body,
    detail,
    async () => {
      const res = await apiClient.post<BroadcastListDto>(
        ENDPOINTS.broadcastLists.create,
        params(body),
      )
      return detail(res.data)
    },
  )
}

/** Rename. `null` or `''` clears the name, and the recipients become the title. */
export async function renameBroadcastList(
  listId: Id,
  name: string | null,
): Promise<BroadcastListDetail> {
  const value = name?.trim() || null
  return write<BroadcastListDto, BroadcastListDetail>(
    SOCKET_ACTIONS.broadcastListUpdate,
    { list_id: listId, name: value },
    detail,
    async () => {
      const res = await apiClient.patch<BroadcastListDto>(
        ENDPOINTS.broadcastLists.update(listId),
        { name: value },
      )
      return detail(res.data)
    },
  )
}

/**
 * REPLACE the recipients — send exactly what the picker shows, so adding and
 * removing are one call. Only the people ADDED are checked for reach.
 */
export async function setBroadcastRecipients(
  listId: Id,
  talkUserIds: Id[],
): Promise<BroadcastListDetail> {
  return write<BroadcastListDto, BroadcastListDetail>(
    SOCKET_ACTIONS.broadcastListMembers,
    { list_id: listId, talk_user_ids: talkUserIds },
    detail,
    async () => {
      const res = await apiClient.put<BroadcastListDto>(
        ENDPOINTS.broadcastLists.members(listId),
        { talk_user_ids: talkUserIds },
      )
      return detail(res.data)
    },
  )
}

/**
 * Delete the LIST. What it already sent stays in every recipient's chat, and its
 * broadcasts stay in the history marked `list_deleted`.
 */
export async function deleteBroadcastList(listId: Id): Promise<void> {
  await write<unknown, void>(
    SOCKET_ACTIONS.broadcastListDelete,
    { list_id: listId },
    () => undefined,
    async () => {
      await apiClient.delete(ENDPOINTS.broadcastLists.remove(listId))
    },
  )
}

/**
 * One upload for every copy — the list's own presign, then the same three steps
 * as a chat attachment. Answers the key to send as `media[].file_url`.
 */
export async function uploadBroadcastAttachment(
  listId: Id,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  return uploadFile(ENDPOINTS.broadcastLists.mediaPresign(listId), file, {
    allowed: ATTACHMENT_CONTENT_TYPES,
    onProgress,
  })
}

/**
 * Send. Writes up to 256 messages before it answers, so both transports wait
 * `BROADCAST_SEND_TIMEOUT_MS`. Idempotent on `client_message_id`: a retry with
 * the same id answers the FIRST broadcast rather than sending a second.
 */
export async function sendBroadcast(input: SendBroadcastInput): Promise<Broadcast> {
  const body = {
    body: input.body?.trim() || undefined,
    media: input.media?.length ? input.media.map(toOutgoingMediaDto) : undefined,
    client_message_id: input.clientMessageId,
    link_preview_url:
      input.linkPreviewUrl && !input.media?.length ? input.linkPreviewUrl : undefined,
  }
  return write<BroadcastDto, Broadcast>(
    SOCKET_ACTIONS.broadcastSend,
    { list_id: input.listId, ...body },
    toBroadcast,
    async () => {
      const res = await apiClient.post<BroadcastDto>(
        ENDPOINTS.broadcastLists.broadcasts(input.listId),
        params(body),
        { timeout: BROADCAST_SEND_TIMEOUT_MS },
      )
      return toBroadcast(res.data)
    },
    { timeoutMs: BROADCAST_SEND_TIMEOUT_MS },
  )
}

function toOutgoingMediaDto(media: OutgoingMedia) {
  return params({
    kind: media.kind,
    file_url: media.fileUrl,
    file_name: media.fileName ?? undefined,
    mime_type: media.mimeType ?? undefined,
    size_bytes: media.sizeBytes ?? undefined,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    duration_seconds: media.durationSeconds ?? undefined,
    thumbnail_url: media.thumbnailUrl ?? undefined,
  })
}

/**
 * A page of broadcasts, NEWEST first from the server — reversed here so the
 * thread draws oldest at the top, the way the chat thread does. `listId` null
 * is the "All broadcasts, including deleted lists" history.
 *
 * Paged by id: `beforeId` is the smallest id held, and an empty page is the
 * start of the history.
 */
export async function fetchBroadcasts(
  listId: Id | null,
  { beforeId, limit = BROADCAST_PAGE_SIZE }: { beforeId?: Id; limit?: number } = {},
): Promise<{ items: Broadcast[]; hasMore: boolean }> {
  const res = await apiClient.get<{ items: BroadcastDto[] }>(
    listId === null ? ENDPOINTS.broadcasts.list : ENDPOINTS.broadcastLists.broadcasts(listId),
    { params: params({ limit, before_id: beforeId }) },
  )
  const newestFirst = res.data.items ?? []
  return {
    items: [...newestFirst].reverse().map(toBroadcast),
    hasMore: newestFirst.length >= limit,
  }
}

/**
 * The delivery report. `status` narrows `items` only — `counts` is always over
 * everyone, which is what the tiles and the tab badges draw.
 */
export async function fetchBroadcastReport(
  broadcastId: Id,
  status?: BroadcastDeliveryStatus,
): Promise<BroadcastReport> {
  const res = await apiClient.get<BroadcastReportDto>(
    ENDPOINTS.broadcasts.recipients(broadcastId),
    { params: params({ status }) },
  )
  const report = toBroadcastReport(res.data)
  rememberPeople(peopleInBroadcastReport(report))
  return report
}
