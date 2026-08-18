import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AuthLayout } from '@/app/layouts/auth-layout'
import { ChatLayout } from '@/app/layouts/chat-layout'
import { LoginPage } from '@/features/auth'
import { ChatPage } from '@/features/chat'
import { PrivateRoute } from './private-route'
import { PublicRoute } from './public-route'
import { NotFoundPage } from './not-found-page'
import { RouteErrorPage } from './route-error-page'

/**
 * The route tree. Mirrors `src/features/` — a route branch exists only where a
 * feature folder does.
 *
 * Record ids never appear in a path. Anything a screen needs rides in a single
 * encrypted `?data=` token built with `encryptId`/`decryptId` from `lib/crypto`.
 */
export const router = createBrowserRouter([
  // A pathless root exists only to carry `errorElement`: an error bubbles to the
  // nearest ancestor that has one, so this single boundary catches every screen
  // — and every layout — instead of react-router's default stack-trace page.
  // With no `element` of its own, react-router renders the children directly.
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicRoute />,
        children: [
          {
            element: <AuthLayout />,
            children: [{ path: '/login', element: <LoginPage /> }],
          },
        ],
      },
      {
        element: <PrivateRoute />,
        children: [
          {
            element: <ChatLayout />,
            // The chat shell survives a crash inside the thread: the sidebar and
            // the socket stay mounted while only the pane is replaced.
            children: [
              { path: '/chat', element: <ChatPage />, errorElement: <RouteErrorPage /> },
            ],
          },
        ],
      },
      { path: '/', element: <Navigate to="/chat" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
