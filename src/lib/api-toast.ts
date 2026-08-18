import { toast } from 'sonner'
import { toApiError } from './api-error'

/** Single place that turns a failed request into a toast. */
export function toastApiError(error: unknown, fallback = 'Something went wrong') {
  const { message } = toApiError(error)
  toast.error(message || fallback)
}

export function toastSuccess(message: string) {
  toast.success(message)
}

/**
 * A failure the client decided on its own, with no request behind it — an
 * oversized attachment, or a retry that cannot be replayed. Kept here so every
 * toast in the app still goes through one module.
 */
export function toastProblem(message: string) {
  toast.error(message)
}
