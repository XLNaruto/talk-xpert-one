import { apiClient } from '@/lib/api-client'
import { ENDPOINTS } from '@/lib/endpoints'
import type { AppConfig } from '@/types/config'
import { toAppConfig, type AppConfigDto } from './config-mappers'

/**
 * The raw bootstrap request. This is the ONLY place axios is called for config;
 * everything else goes through `stores/config-store.ts` or the
 * `hooks/use-app-config.ts` selectors.
 *
 * Config is app-wide infrastructure rather than a screen, so it sits in `lib/`
 * beside `api-client` instead of in a `features/` folder — there is no page,
 * no form and no component that belongs to it.
 */
export async function fetchAppConfig(): Promise<AppConfig> {
  // No envelope: `GET /config` answers the three fields at the top level.
  const res = await apiClient.get<AppConfigDto>(ENDPOINTS.config)
  return toAppConfig(res.data)
}
