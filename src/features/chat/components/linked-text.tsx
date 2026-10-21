import { Fragment, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { splitLinks } from '../lib/link-preview'

/**
 * A message's text with its links clickable. Opens in a new tab, and the click
 * stops at the link: the bubble behind it opens a context menu and, during a
 * selection, ticks the message — neither should fire from following a link.
 */
export function LinkedText({ text, isMine }: { text: string; isMine: boolean }) {
  const segments = useMemo(() => splitLinks(text), [text])
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'link' ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'underline underline-offset-2 transition-opacity hover:opacity-80',
              isMine ? 'decoration-white/60' : 'text-primary decoration-primary/50',
            )}
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}
