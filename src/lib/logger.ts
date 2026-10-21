/** Console wrapper — failures only. `warn` is dev-only; `error` always prints. */
export const logger = {
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn('[xpertone-talk]', ...args)
  },
  error: (...args: unknown[]) => console.error('[xpertone-talk]', ...args),
}
