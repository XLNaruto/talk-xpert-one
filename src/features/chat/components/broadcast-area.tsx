import { ArrowLeft, History, Info, Loader2, Megaphone, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { Tip } from '@/components/common/tip'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import { useBroadcastArea } from '../hooks/use-broadcast-area'
import { broadcastListTitle } from '../lib/broadcast-labels'
import { BroadcastBubbles, BroadcastComposer } from './broadcast-thread'
import { BroadcastInfoSheet } from './broadcast-info-sheet'
import { BroadcastListDialog } from './broadcast-list-dialog'
import { BroadcastReportDialog } from './broadcast-report-dialog'

/**
 * A broadcast list open in the main pane — the same shape as a chat: header,
 * thread, composer. Every bubble is mine; replies happen in each person's 1:1
 * chat, which the delivery report opens.
 *
 * `target` `'all'` is the history across every list, deleted ones included. It
 * has no composer — there is no list to send to.
 */
export function BroadcastArea({ target }: { target: Id | 'all' }) {
  const area = useBroadcastArea(target)
  const setActiveChat = useChatStore((s) => s.setActiveChat)
  const { history, sender, list } = area

  return (
    <section className="thread-canvas relative flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 py-2">
        <Tip label="Back to conversations">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 md:hidden"
            onClick={area.showSidebar}
            aria-label="Back to conversations"
          >
            <ArrowLeft />
          </Button>
        </Tip>

        <button
          type="button"
          onClick={area.isHistory ? undefined : area.openInfo}
          disabled={area.isHistory || !list}
          className="flex min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left enabled:cursor-pointer"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            {area.isHistory ? <History className="size-4" /> : <Megaphone className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
              {area.title}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {area.subtitle}
            </span>
          </span>
        </button>

        <span className="min-w-0 flex-1" aria-hidden />

        {!area.isHistory && list && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                aria-label="Broadcast actions"
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={area.openInfo}>
                <Info />
                Broadcast info
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={area.openEdit}>
                <Pencil />
                Edit broadcast
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={area.askDelete}>
                <Trash2 />
                Delete broadcast
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {history.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : history.items.length === 0 && sender.pending.length === 0 ? (
          <EmptyState
            icon={<Megaphone />}
            title={area.isHistory ? 'Nothing broadcast yet' : 'Send the first broadcast'}
            description={
              area.isHistory
                ? 'Everything you send to a list shows up here, even after the list is deleted.'
                : 'Everyone on this list gets it as a private message from you, and replies in your chat with them. Nobody sees who else got it.'
            }
          />
        ) : (
          <BroadcastBubbles
            items={history.items}
            pending={sender.pending}
            showListName={area.isHistory}
            hasMore={history.hasMore}
            isLoadingMore={history.isLoadingMore}
            onLoadEarlier={() => void history.loadEarlier()}
            onOpenReport={area.openReport}
            onRetry={sender.retry}
            onDiscard={sender.discard}
          />
        )}
      </div>

      {!area.isHistory && (
        <div className="shrink-0 px-3 py-2.5">
          <BroadcastComposer onSend={sender.send} />
        </div>
      )}

      {area.panel === 'info' && list && (
        <BroadcastInfoSheet
          list={list}
          onEdit={area.openEdit}
          onDelete={area.askDelete}
          onClose={area.closePanel}
        />
      )}

      {area.panel === 'edit' && list && (
        <BroadcastListDialog
          // Keyed so the form starts from what the list holds NOW.
          key={list.id}
          existing={list}
          onDone={area.closePanel}
          onClose={area.closePanel}
        />
      )}

      {area.panel === 'delete' && list && (
        <ConfirmDialog
          title="Delete this broadcast?"
          message={`${broadcastListTitle(list, list.recipients)} goes away. Everything it already sent stays in each person's chat with you, and in All broadcasts.`}
          confirmLabel="Delete broadcast"
          tone="destructive"
          isPending={area.isDeleting}
          onCancel={area.closePanel}
          onConfirm={() => void area.deleteList()}
        />
      )}

      {area.reportFor !== null && (
        <BroadcastReportDialog
          broadcastId={area.reportFor}
          // A delivered row opens that person's 1:1 chat, where replies land.
          onOpenChat={(chatId) => setActiveChat(chatId)}
          onClose={area.closeReport}
        />
      )}
    </section>
  )
}
