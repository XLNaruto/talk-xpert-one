import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/app/providers'
import { router } from '@/app/router/router'
import { useAuthStore } from '@/stores/auth-store'
import { useChatListStore } from '@/stores/chat-list-store'
import { bootstrapAppConfig, useConfigStore } from '@/stores/config-store'
import { useUiStore } from '@/stores/ui-store'
import '@/styles/globals.css'

// Every persisted store is backed by IndexedDB (async) with `skipHydration`, so
// rehydrate them ALL before mounting the router:
//  • auth — the route guards read the store synchronously and would otherwise
//    bounce a signed-in user to /login on refresh;
//  • chats — the sidebar should paint its last known rows rather than a spinner
//    while the list read is in flight;
//  • ui — first paint should already carry the saved theme (no flash);
//  • config — the media prefix and realtime origin decide what the first paint
//    can even show, so the last known copy must be in hand before we ask for a
//    fresh one.
//
// ADD ANY NEW PERSISTED STORE TO THIS LIST.
Promise.all(
  [useAuthStore, useChatListStore, useConfigStore, useUiStore].map(
    (store) => Promise.resolve(store.persist.rehydrate()),
  ),
)
  // Then read `GET /config` — awaited only on a first-ever launch, refreshed in
  // the background when a persisted copy already exists. A failed read never
  // blocks the app: the store keeps the old values and env supplies fallbacks.
  .then(() => bootstrapAppConfig())
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    )
  })
