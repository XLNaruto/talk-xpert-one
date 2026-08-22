import type { PushDevice } from '../types'

/** `POST`/`GET /talk/devices` — the registration, never the token itself. */
export interface PushDeviceDto {
  id: number
  platform: string
  device_name?: string | null
  app_version?: string | null
  last_used_at?: string | null
  created_at?: string | null
}

export interface PushDeviceListDto {
  items: PushDeviceDto[]
}

export function toPushDevice(dto: PushDeviceDto): PushDevice {
  return {
    id: dto.id,
    platform: dto.platform,
    deviceName: dto.device_name ?? null,
    appVersion: dto.app_version ?? null,
    lastUsedAt: dto.last_used_at ?? null,
    createdAt: dto.created_at ?? null,
  }
}
