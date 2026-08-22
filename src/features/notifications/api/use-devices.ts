import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import * as deviceApi from './device-api'
import type { PushDevice } from '../types'

/**
 * Hooks over the device registry. Talk has no server-state library, so these own
 * their own pending flags.
 */

/**
 * Save a token. Never throws: a failed registration means this browser gets no
 * pushes, which is a degradation, not a reason to interrupt someone's chat.
 */
export function useRegisterPushDevice() {
  const [isPending, setPending] = useState(false)

  const mutate = useCallback(async (token: string): Promise<boolean> => {
    setPending(true)
    try {
      await deviceApi.registerDevice(token)
      return true
    } catch (error) {
      logger.warn('push device registration failed', error)
      return false
    } finally {
      setPending(false)
    }
  }, [])

  return { mutate, isPending }
}

/** The registered handsets — for an account screen. Never lists the tokens. */
export function usePushDevices() {
  const [devices, setDevices] = useState<PushDevice[] | null>(null)

  useEffect(() => {
    let cancelled = false
    deviceApi
      .fetchDevices()
      .then((items) => {
        if (!cancelled) setDevices(items)
      })
      .catch((error) => {
        logger.warn('device list read failed', error)
        if (!cancelled) setDevices([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { devices: devices ?? [], isLoading: devices === null }
}
