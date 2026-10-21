import { useCallback, useEffect, useState } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import type { Id } from '@/types/api'
import {
  useBroadcastHistory,
  useBroadcastListActions,
  useBroadcastListDetail,
  useSendBroadcast,
} from '../api/use-broadcasts'
import { broadcastListTitle, recipientCountLine } from '../lib/broadcast-labels'
import type { Broadcast } from '../types'

/**
 * The broadcast pane's logic — the main-pane twin of `use-message-thread`.
 *
 * `target` is one list, or `'all'` for every broadcast ever sent (deleted lists
 * included), which reads the same history route without a list and has no
 * composer: there is nothing to send TO.
 *
 * A list deleted on another device closes itself — the event cannot reach this
 * state, so it arrives through `removedBroadcastListIds`.
 */
export function useBroadcastArea(target: Id | 'all') {
  const listId = target === 'all' ? null : target
  const setActiveBroadcast = useChatStore((s) => s.setActiveBroadcast)
  const removed = useChatStore((s) => s.removedBroadcastListIds)
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const { list, isGone } = useBroadcastListDetail(listId)
  const history = useBroadcastHistory(listId)
  const { remove, isPending: isDeleting } = useBroadcastListActions()

  const merge = history.merge
  // The ack's broadcast replaces the pending bubble; the `talk.broadcast.sent`
  // that follows merges onto it by id.
  const onSent = useCallback((broadcast: Broadcast) => merge([broadcast]), [merge])
  const sender = useSendBroadcast(listId, onSent)

  /** Which sheet is over the pane, and whose delivery report. */
  const [panel, setPanel] = useState<'info' | 'edit' | 'delete' | null>(null)
  const [reportFor, setReportFor] = useState<Id | null>(null)

  // A different list starts with nothing open over it.
  useEffect(() => {
    setPanel(null)
    setReportFor(null)
  }, [target])

  const close = useCallback(() => setActiveBroadcast(null), [setActiveBroadcast])

  useEffect(() => {
    if (listId !== null && (isGone || removed.includes(listId))) close()
  }, [listId, isGone, removed, close])

  const deleteList = useCallback(async () => {
    if (listId === null) return
    if (await remove(listId)) close()
  }, [listId, remove, close])

  return {
    isHistory: listId === null,
    list,
    title:
      listId === null
        ? 'All broadcasts'
        : list
          ? broadcastListTitle(list, list.recipients)
          : 'Broadcast',
    subtitle:
      listId === null
        ? 'Every broadcast you sent, including deleted lists'
        : list
          ? recipientCountLine(list.recipientCount)
          : '',
    history,
    sender,
    panel,
    openInfo: useCallback(() => setPanel('info'), []),
    openEdit: useCallback(() => setPanel('edit'), []),
    askDelete: useCallback(() => setPanel('delete'), []),
    closePanel: useCallback(() => setPanel(null), []),
    deleteList,
    isDeleting,
    reportFor,
    openReport: setReportFor,
    closeReport: useCallback(() => setReportFor(null), []),
    /** Back to the list on a phone, where the sidebar is an overlay. */
    showSidebar: useCallback(() => setSidebarOpen(true), [setSidebarOpen]),
  }
}
