import { useCallback, useEffect, useRef, useState } from 'react'
import { toApiError } from '@/lib/api-error'
import { toastApiError, toastSuccess } from '@/lib/api-toast'
import { useChatStore } from '@/stores/chat-store'
import { keyOf, type Id } from '@/types/api'
import { BROADCAST_LIST_PAGE_SIZE } from '../constants'
import { mediaKindFor } from '../lib/chat-mappers'
import { sendFailure } from '../lib/send-failures'
import type {
  Broadcast,
  BroadcastDeliveryStatus,
  BroadcastList,
  BroadcastListDetail,
  BroadcastReport,
  LinkPreview,
  OutgoingMedia,
} from '../types'
import * as broadcastApi from './broadcast-api'

/**
 * Broadcast lists, for the screens that show them.
 *
 * None of this is in a store: only the OWNER ever sees a list, the screens are
 * open for a minute at a time, and the four broadcast events reach them as a
 * revision tick (`broadcastRevision`) that asks for a re-read — the same way the
 * pin bar and the member sheet learn of a change they cannot be handed.
 */

/** The Broadcast Lists screen. */
export function useBroadcastLists() {
  const revision = useChatStore((s) => s.broadcastRevision)
  const [lists, setLists] = useState<BroadcastList[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setLoading] = useState(true)
  const [isLoadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    broadcastApi
      .fetchBroadcastLists()
      .then((page) => {
        if (cancelled) return
        setLists(page.items)
        setTotal(page.total)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError('Your broadcasts could not be loaded. Try again in a moment.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const page = await broadcastApi.fetchBroadcastLists({
        offset: lists.length,
        limit: BROADCAST_LIST_PAGE_SIZE,
      })
      setLists((held) => [
        ...held,
        ...page.items.filter((item) => !held.some((list) => list.id === item.id)),
      ])
      setTotal(page.total)
    } catch (cause) {
      toastApiError(cause, 'More lists could not be loaded')
    } finally {
      setLoadingMore(false)
    }
  }, [lists.length])

  return {
    lists,
    total,
    isLoading,
    isLoadingMore,
    hasMore: lists.length < total,
    loadMore,
    error,
  }
}

/**
 * One list with everyone on it. `isGone` is a 404 — deleted, here or on another
 * device — which the screen answers by going back to the lists.
 */
export function useBroadcastListDetail(listId: Id | null) {
  const revision = useChatStore((s) => s.broadcastRevision)
  const [list, setList] = useState<BroadcastListDetail | null>(null)
  const [isGone, setGone] = useState(false)

  useEffect(() => {
    if (listId === null) {
      setList(null)
      return
    }
    let cancelled = false
    setGone(false)
    broadcastApi
      .fetchBroadcastList(listId)
      .then((detail) => {
        if (!cancelled) setList(detail)
      })
      .catch((cause) => {
        if (!cancelled && toApiError(cause).status === 404) setGone(true)
      })
    return () => {
      cancelled = true
    }
  }, [listId, revision])

  return { list, isGone, setList }
}

/**
 * A list's thread — or, with `listId` null, every broadcast ever sent, deleted
 * lists included. Oldest first, paged backwards by id.
 *
 * A revision re-reads only the NEWEST page and merges it by id, so a send from
 * another device appears without throwing away the older pages already held.
 */
export function useBroadcastHistory(listId: Id | null) {
  const revision = useChatStore((s) => s.broadcastRevision)
  const [items, setItems] = useState<Broadcast[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setLoading] = useState(true)
  const [isLoadingMore, setLoadingMore] = useState(false)
  const loadingMore = useRef(false)
  /** True until the first read of this thread lands — see `hasMore` below. */
  const firstRead = useRef(true)

  const merge = useCallback((incoming: Broadcast[]) => {
    setItems((held) => {
      const byId = new Map(held.map((item) => [item.id, item]))
      for (const item of incoming) byId.set(item.id, item)
      return [...byId.values()].sort((a, b) => a.id - b.id)
    })
  }, [])

  // A different list is a different thread: start clean rather than merging.
  useEffect(() => {
    setItems([])
    setHasMore(false)
    setLoading(true)
    firstRead.current = true
  }, [listId])

  useEffect(() => {
    let cancelled = false
    broadcastApi
      .fetchBroadcasts(listId)
      .then((page) => {
        if (cancelled) return
        merge(page.items)
        // Only the FIRST read decides whether there is history above; a
        // refresh of the newest page says nothing about the oldest.
        if (firstRead.current) setHasMore(page.hasMore)
      })
      .catch((cause) => {
        if (!cancelled) toastApiError(cause, 'Those broadcasts could not be loaded')
      })
      .finally(() => {
        if (!cancelled) {
          firstRead.current = false
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [listId, revision, merge])

  const loadEarlier = useCallback(async () => {
    if (loadingMore.current || items.length === 0) return
    loadingMore.current = true
    setLoadingMore(true)
    try {
      const page = await broadcastApi.fetchBroadcasts(listId, { beforeId: items[0].id })
      merge(page.items)
      // An empty page is the start of the history.
      setHasMore(page.items.length > 0 && page.hasMore)
    } catch (cause) {
      toastApiError(cause, 'Earlier broadcasts could not be loaded')
    } finally {
      loadingMore.current = false
      setLoadingMore(false)
    }
  }, [items, listId, merge])

  return { items, hasMore, isLoading, isLoadingMore, loadEarlier, merge }
}

/** The list-level writes. Each toasts its own outcome; the screens only navigate. */
export function useBroadcastListActions() {
  const bumpBroadcasts = useChatStore((s) => s.bumpBroadcasts)
  const [isPending, setPending] = useState(false)

  const run = useCallback(
    async <T,>(task: () => Promise<T>, failure: string, success?: string): Promise<T | null> => {
      setPending(true)
      try {
        const result = await task()
        // The event will say the same to my other devices; this device re-reads
        // now rather than waiting on an echo it may never be sent.
        bumpBroadcasts()
        if (success) toastSuccess(success)
        return result
      } catch (cause) {
        toastApiError(cause, failure)
        return null
      } finally {
        setPending(false)
      }
    },
    [bumpBroadcasts],
  )

  const create = useCallback(
    (name: string | null, talkUserIds: Id[]) =>
      run(
        () => broadcastApi.createBroadcastList({ name, talkUserIds }),
        'That broadcast was not created',
      ),
    [run],
  )

  const rename = useCallback(
    (listId: Id, name: string | null) =>
      run(() => broadcastApi.renameBroadcastList(listId, name), 'That name did not save', 'List renamed'),
    [run],
  )

  const setRecipients = useCallback(
    (listId: Id, talkUserIds: Id[]) =>
      run(
        () => broadcastApi.setBroadcastRecipients(listId, talkUserIds),
        'Those recipients did not save',
        'Recipients updated',
      ),
    [run],
  )

  const remove = useCallback(
    async (listId: Id) => {
      const done = await run(
        async () => {
          await broadcastApi.deleteBroadcastList(listId)
          return true
        },
        'That list was not deleted',
        'Broadcast deleted',
      )
      return done === true
    },
    [run],
  )

  return { create, rename, setRecipients, remove, isPending }
}

/**
 * A broadcast on its way — drawn in the thread until the server's own row
 * replaces it, and kept as `failed` (never dropped) when it does not arrive.
 */
export interface PendingBroadcast {
  clientMessageId: string
  body: string | null
  files: File[]
  linkPreviewUrl: string | null
  linkPreview: LinkPreview | null
  status: 'sending' | 'failed'
  /** 0–1 across the uploads. */
  progress: number
  failureReason?: string
  createdAt: string
}

/**
 * Sending to a list: upload once, send once, and let the server write every copy.
 *
 * The same promises as a chat send. A failure stays on screen as `failed` with
 * its reason, and a retry replays the SAME `client_message_id` — so a send whose
 * answer was lost comes back as the first broadcast rather than a second one to
 * all 256 people. A failed upload has no key to replay, so a retry uploads again.
 */
export function useSendBroadcast(listId: Id | null, onSent: (broadcast: Broadcast) => void) {
  const [pending, setPending] = useState<PendingBroadcast[]>([])

  const patch = useCallback((clientMessageId: string, change: Partial<PendingBroadcast>) => {
    setPending((held) =>
      held.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, ...change } : item,
      ),
    )
  }, [])

  const deliver = useCallback(
    async (item: PendingBroadcast) => {
      if (listId === null) return
      try {
        const media: OutgoingMedia[] = []
        for (const [index, file] of item.files.entries()) {
          const key = await broadcastApi.uploadBroadcastAttachment(listId, file, (fraction) =>
            patch(item.clientMessageId, { progress: (index + fraction) / item.files.length }),
          )
          media.push({
            kind: mediaKindFor(file.type),
            fileUrl: key,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          })
        }
        const broadcast = await broadcastApi.sendBroadcast({
          listId,
          body: item.body,
          media,
          clientMessageId: item.clientMessageId,
          linkPreviewUrl: item.linkPreviewUrl,
        })
        setPending((held) => held.filter((row) => row.clientMessageId !== item.clientMessageId))
        onSent(broadcast)
      } catch (cause) {
        patch(item.clientMessageId, {
          status: 'failed',
          failureReason: sendFailure(cause).reason,
        })
      }
    },
    [listId, onSent, patch],
  )

  const send = useCallback(
    (draft: {
      body: string
      files: File[]
      linkPreviewUrl: string | null
      linkPreview: LinkPreview | null
    }) => {
      const item: PendingBroadcast = {
        clientMessageId: crypto.randomUUID(),
        body: draft.body.trim() || null,
        files: draft.files,
        linkPreviewUrl: draft.files.length === 0 ? draft.linkPreviewUrl : null,
        linkPreview: draft.files.length === 0 ? draft.linkPreview : null,
        status: 'sending',
        progress: 0,
        createdAt: new Date().toISOString(),
      }
      setPending((held) => [...held, item])
      void deliver(item)
    },
    [deliver],
  )

  const retry = useCallback(
    (clientMessageId: string) => {
      const item = pending.find((row) => row.clientMessageId === clientMessageId)
      if (!item) return
      const again = { ...item, status: 'sending' as const, failureReason: undefined, progress: 0 }
      patch(clientMessageId, again)
      void deliver(again)
    },
    [pending, patch, deliver],
  )

  const discard = useCallback((clientMessageId: string) => {
    setPending((held) => held.filter((row) => row.clientMessageId !== clientMessageId))
  }, [])

  // A different list has nothing of this one's in flight to show.
  useEffect(() => setPending([]), [listId])

  return { pending, send, retry, discard }
}

/**
 * The delivery report for one broadcast, one tab at a time. `status` narrows the
 * people; `counts` is always over everyone.
 *
 * Reads that land while it is open are laid over it from `talk.broadcast.read`:
 * the person's row turns read, and the count is the server's new total.
 */
export function useBroadcastReport(broadcastId: Id, status: BroadcastDeliveryStatus | null) {
  const [report, setReport] = useState<BroadcastReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(true)
  const live = useChatStore((s) => s.broadcastReads[keyOf(broadcastId)])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    broadcastApi
      .fetchBroadcastReport(broadcastId, status ?? undefined)
      .then((answer) => {
        if (!cancelled) {
          setReport(answer)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError('The delivery report could not be loaded. Close this and try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [broadcastId, status])

  const withLive: BroadcastReport | null =
    report && live
      ? {
          ...report,
          counts: { ...report.counts, read: Math.max(report.counts.read, live.readCount) },
          items: report.items.map((item) => {
            const readAt = live.readers[keyOf(item.talkUserId)]
            return readAt && !item.isRead ? { ...item, isRead: true, readAt } : item
          }),
        }
      : report

  return { report: withLive, error, isLoading }
}
