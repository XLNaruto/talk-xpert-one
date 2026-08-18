import axios from 'axios'

/**
 * Talk answers a failure as `{ code, message, details? }` — no `errors` object
 * and no envelope. `details` is a zod issue list on a `VALIDATION` response.
 */
interface TalkErrorBody {
  code?: string
  message?: string
  details?: Array<{ message?: string; params?: { issue?: { path?: Array<string | number> } } }>
}

export interface ApiError {
  status: number
  /** The server's own `code` — `UNAUTHORIZED`, `VALIDATION`, `FORBIDDEN`, … */
  code: string
  message: string
  /** Field-level messages keyed by form field, unpacked from `details`. */
  fields?: Record<string, string>
}

/** Normalise anything thrown by axios into a predictable shape. */
export function toApiError(error: unknown, fallback = 'Something went wrong'): ApiError {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as TalkErrorBody | undefined
    return {
      status: error.response?.status ?? 0,
      code: body?.code ?? 'NETWORK',
      message: body?.message || error.message || fallback,
      fields: toFieldErrors(body?.details),
    }
  }
  if (error instanceof Error) return { status: 0, code: 'CLIENT', message: error.message }
  return { status: 0, code: 'CLIENT', message: fallback }
}

/**
 * A 401 is retryable — refresh the token once and replay. A 403 is NOT: the
 * credential is suspended, or the group owner blocked you from posting. See
 * §3.5 of the implementation guide: `401` ⇒ try refresh once, `403` ⇒ stop.
 */
export function isUnauthorized(error: unknown): boolean {
  return toApiError(error).status === 401
}

export function isForbidden(error: unknown): boolean {
  return toApiError(error).status === 403
}

/**
 * A chat you are not in answers `404`, never `403` — a 403 would confirm it
 * exists. So a 404 means "gone or never yours", not "deleted".
 */
export function isMissing(error: unknown): boolean {
  return toApiError(error).status === 404
}

/** Zod issue list → `{ platform: 'Required' }`, for inline form errors. */
function toFieldErrors(details: TalkErrorBody['details']): Record<string, string> | undefined {
  if (!details?.length) return undefined
  const fields: Record<string, string> = {}
  for (const detail of details) {
    const path = detail.params?.issue?.path
    const name = path?.length ? String(path[path.length - 1]) : undefined
    if (name && detail.message && !fields[name]) fields[name] = detail.message
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}
