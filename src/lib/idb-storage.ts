import { createStore, get, set, del } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'
import { env } from '@/config/env'
import { decryptText, encryptText } from './crypto'
import { logger } from './logger'

/**
 * IndexedDB-backed storage for persisted Zustand stores.
 *
 * Rule: nothing goes in localStorage/sessionStorage. IndexedDB is async, so
 * every store built on this sets `skipHydration: true` and is rehydrated in
 * `main.tsx` before the app mounts.
 *
 * The database name carries the app namespace, so One Talk and the admin app
 * never share a store even on the same origin.
 */
const store = createStore(`${env.VITE_APP_COOKIE_PREFIX}-store`, 'keyval')

export const createIdbStorage = (): StateStorage => ({
  getItem: async (name) => (await get<string>(name, store)) ?? null,
  setItem: async (name, value) => set(name, value, store),
  removeItem: async (name) => del(name, store),
})

/**
 * Same as above but encrypted at rest — use for anything holding credentials.
 * A payload that fails to decrypt is dropped rather than thrown, so rotating
 * `VITE_APP_ENCRYPT_KEY` signs the user out instead of bricking the app.
 */
export const createIdbSessionStorage = (): StateStorage => ({
  getItem: async (name) => {
    const cipher = await get<string>(name, store)
    if (!cipher) return null
    const plain = decryptText(cipher)
    if (!plain) {
      logger.warn('dropping unreadable persisted session', name)
      await del(name, store)
      return null
    }
    return plain
  },
  setItem: async (name, value) => set(name, encryptText(value), store),
  removeItem: async (name) => del(name, store),
})
