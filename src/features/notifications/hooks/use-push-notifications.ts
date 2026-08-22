import { useCallback, useEffect, useRef, useState } from 'react'
import { isPushConfigured } from '@/config/env'
import {
  isPushSupported,
  onForegroundPush,
  pushPermission,
  requestPushPermission,
  requestPushToken,
} from '@/lib/firebase-messaging'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/auth-store'
import { useRegisterPushDevice } from '../api/use-devices'
import { PUSH_CLIENT_MESSAGES, PUSH_REGISTER_DELAY_MS } from '../constants'
import { publishPushClick, publishPushEvent } from '../lib/push-bus'
import { parsePushEvent, type PushData } from '../lib/push-payload'
import type { PushStatus } from '../types'

/**
 * The whole push lifecycle for this browser, mounted ONCE by `chat-layout.tsx`.
 *
 * Four jobs, and only the first of them is about notifications at all:
 *
 *  1. get a token and register it — on every launch, after every login, and
 *     whenever it rotates. `POST /talk/devices` is an upsert and it is how the
 *     server knows the browser is still alive, so it is called every time
 *     rather than skipped on a cached "already registered";
 *  2. deliver a foreground push to the app instead of drawing a banner over the
 *     conversation the user is already looking at;
 *  3. deliver a background push, forwarded by the service worker, so a hidden
 *     tab's caches stay correct without the user seeing anything;
 *  4. open what a tapped banner named.
 *
 * All of it is dormant until the Firebase values are in `.env`. Unconfigured is
 * reported as a status, logged once, and nothing else changes.
 */
export function usePushNotifications() {
  const talkUserId = useAuthStore((s) => s.identity?.talkUserId)
  const [status, setStatus] = useState<PushStatus>(() =>
    isPushConfigured() ? 'prompt' : 'unconfigured',
  )
  const register = useRegisterPushDevice().mutate

  // Handlers must not rebind when the callback identity changes — the service
  // worker listener would then miss messages between the two.
  const registerRef = useRef(register)
  registerRef.current = register

  /** Ask for a token and save it. Silent on every refusal — see `isPushSupported`. */
  const syncToken = useCallback(async () => {
    const token = await requestPushToken()
    if (!token) return false
    return registerRef.current(token)
  }, [])

  /* ---- 1. status, then the token ---- */

  useEffect(() => {
    if (talkUserId == null) return
    if (!isPushConfigured()) {
      setStatus('unconfigured')
      logger.warn('push notifications are off: no Firebase config in this build')
      return
    }

    let cancelled = false
    // Deliberately late. The launch is already spending its network on the chat
    // list, the socket handshake and the identity confirmation.
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!(await isPushSupported())) {
          if (!cancelled) setStatus('unsupported')
          return
        }
        const permission = pushPermission()
        if (cancelled) return
        if (permission !== 'granted') {
          // `denied` is FINAL — the browser will not show the prompt again from
          // script, so the UI must offer nothing rather than a button that
          // cannot work.
          setStatus(permission === 'denied' ? 'denied' : 'prompt')
          return
        }
        setStatus('granted')
        await syncToken()
      })()
    }, PUSH_REGISTER_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [talkUserId, syncToken])

  /* ---- 2. a push while this tab has focus ---- */

  useEffect(() => {
    if (talkUserId == null) return
    return onForegroundPush((payload) => {
      // No banner: this tab is the one being looked at, and the thread it
      // belongs to may already be open. The event still has to be applied.
      const event = parsePushEvent(payload.data as PushData | undefined)
      if (event) publishPushEvent(event)
    })
  }, [talkUserId])

  /* ---- 3 & 4. the service worker: background pushes, and taps ---- */

  useEffect(() => {
    if (talkUserId == null) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const onWorkerMessage = (message: MessageEvent) => {
      const body = message.data as
        | { type?: string; data?: PushData; payload?: PushData | null }
        | undefined
      if (!body?.type) return

      if (body.type === PUSH_CLIENT_MESSAGES.event) {
        const event = parsePushEvent(body.data)
        if (event) publishPushEvent(event)
        return
      }

      if (body.type === PUSH_CLIENT_MESSAGES.click) {
        const event = parsePushEvent(body.payload)
        // The event is applied AS WELL as opened: a tap from a cold start is
        // often the first this client has heard of the message.
        if (event) {
          publishPushEvent(event)
          publishPushClick(event)
        }
      }
    }

    navigator.serviceWorker.addEventListener('message', onWorkerMessage)

    // A tap that had to cold-start the app has no page to be handed to, so the
    // worker holds it until asked. Best effort — a worker may be killed in
    // between, and then the app simply opens on its last conversation.
    void navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({ type: PUSH_CLIENT_MESSAGES.claimClick })
      })
      .catch(() => {
        // No worker registered yet (push never enabled here). Nothing to claim.
      })

    return () => {
      navigator.serviceWorker.removeEventListener('message', onWorkerMessage)
    }
  }, [talkUserId])

  /**
   * Turn notifications on, from a user gesture.
   *
   * Safari requires the gesture and Chrome all but requires it, which is why
   * this is a button rather than something fired at launch. A `denied` answer is
   * final and the UI stops offering.
   */
  const enable = useCallback(async () => {
    if (!(await isPushSupported())) {
      setStatus(isPushConfigured() ? 'unsupported' : 'unconfigured')
      return
    }
    const permission = await requestPushPermission()
    if (permission !== 'granted') {
      setStatus(permission === 'denied' ? 'denied' : 'prompt')
      return
    }
    setStatus('granted')
    await syncToken()
  }, [syncToken])

  return { status, enable }
}
