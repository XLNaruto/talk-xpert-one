import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function MessageListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn('flex', i % 3 === 0 ? 'justify-end' : 'justify-start')}>
          <Skeleton
            className={cn('h-10 rounded-2xl', i % 2 === 0 ? 'w-48' : 'w-64')}
          />
        </div>
      ))}
    </div>
  )
}
