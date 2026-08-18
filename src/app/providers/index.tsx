import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from './theme-provider'
import { SocketProvider } from './socket-provider'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <SocketProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </SocketProvider>
    </ThemeProvider>
  )
}
