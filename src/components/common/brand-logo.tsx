import { MessagesSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <MessagesSquare className="size-5 text-primary" />
      XpertOne Talk
    </span>
  )
}
