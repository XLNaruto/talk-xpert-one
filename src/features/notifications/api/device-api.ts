import { apiClient } from '@/lib/api-client'
import { ENDPOINTS } from '@/lib/endpoints'
import { CLIENT_PLATFORM } from '@/lib/platform'
import { describeThisBrowser } from '../lib/device-label'
import { toPushDevice, type PushDeviceDto, type PushDeviceListDto } from '../lib/device-mappers'
import type { PushDevice } from '../types'

/**
 * The device registry. The ONLY place axios is called for push; the hook in
 * `use-devices.ts` is what anything above it uses.
 *
 * There is no `talk_user_id` in any of these bodies, and that is deliberate: the
 * bearer names the only participant a device can belong to.
 */

/**
 * Save this browser's FCM token. An UPSERT — calling it repeatedly with the same
 * token is the NORMAL path, not an error, and is how the server knows the device
 * is still alive. Never cache "already registered" and skip it.
 *
 * `platform` is the same slot the login claimed (`WEB`, from `lib/platform.ts`).
 * It is not a label: saving a token retires whatever token held that slot, so a
 * browser that claimed `MAC` would silently evict the user's desktop app.
 */
export async function registerDevice(token: string): Promise<PushDevice> {
  const res = await apiClient.post<PushDeviceDto>(ENDPOINTS.devices, {
    token,
    platform: CLIENT_PLATFORM,
    device_name: describeThisBrowser(),
  })
  return toPushDevice(res.data)
}

/**
 * Drop a token NOW.
 *
 * Not needed on a normal sign-out — `POST /talk/auth/logout` already drops this
 * platform's registration. It is for the two cases that skip that route: local
 * state cleared without a logout, and a token we rotated ourselves. Idempotent,
 * and scoped to our own devices: somebody else's token answers `removed: false`
 * rather than deleting their registration.
 */
export async function removeDevice(token: string): Promise<boolean> {
  const res = await apiClient.delete<{ removed: boolean }>(ENDPOINTS.devices, {
    data: { token },
  })
  return Boolean(res.data?.removed)
}

/** The handsets that can receive a notification, most recently active first. */
export async function fetchDevices(): Promise<PushDevice[]> {
  const res = await apiClient.get<PushDeviceListDto>(ENDPOINTS.devices)
  return (res.data?.items ?? []).map(toPushDevice)
}
