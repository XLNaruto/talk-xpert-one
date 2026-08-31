/** Dev-only console wrapper — silent in production builds. */
export const logger = {
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.debug('[xpertone-talk]', ...args)
  },
  /**
   * Like `debug`, but at a level Chrome shows WITHOUT "Verbose" ticked.
   *
   * For the handful of lines somebody actually goes looking for when a feature
   * appears to do nothing — the push lifecycle, above all: token, registration,
   * delivery. A `debug` line that nobody can see is the same as no line.
   */
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.info('[xpertone-talk]', ...args)
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn('[xpertone-talk]', ...args)
  },
  error: (...args: unknown[]) => console.error('[xpertone-talk]', ...args),
}
