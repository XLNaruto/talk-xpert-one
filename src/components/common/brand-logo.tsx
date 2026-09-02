import { cn } from '@/lib/utils'

export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logos/logo.png"
      alt="XpertOne Talk"
      className={cn('h-14 w-auto shrink-0 object-contain', className)}
    />
  )
}
