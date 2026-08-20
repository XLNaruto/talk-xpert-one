import { useState } from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string | null
  className?: string
}

/**
 * The eight avatar fills, spelled out so Tailwind can see the class names — a
 * template literal would be invisible to the scanner and the fill would come
 * out transparent in the build.
 */
const AVATAR_TONES = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
] as const

/** Initials fallback, so a missing or broken image never leaves a hole. */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Same name → same colour, every render and every screen. A plain sum of the
 * code points is enough: this only has to be stable and spread across eight
 * buckets, not resist collisions.
 */
function tone(name: string): string {
  let sum = 0
  for (let i = 0; i < name.length; i += 1) sum = (sum + name.charCodeAt(i)) % 1024
  return AVATAR_TONES[sum % AVATAR_TONES.length]
}

export function Avatar({ name, src, className }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImage = src && !failed

  return (
    <span
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full',
        'text-xs font-semibold select-none',
        // The tinted ring keeps a PHOTO from melting into the active row too —
        // the fill under it is only visible while the image is missing.
        'ring-1 ring-black/5 dark:ring-white/10',
        showImage ? 'bg-muted' : cn(tone(name), 'text-avatar-foreground'),
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  )
}
