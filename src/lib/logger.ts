/** Dev-only console wrapper — silent in production builds. */
export const logger = {
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.debug('[xpertone-talk]', ...args)
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn('[xpertone-talk]', ...args)
  },
  error: (...args: unknown[]) => console.error('[xpertone-talk]', ...args),
}
