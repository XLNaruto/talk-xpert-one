/**
 * A human name for this browser, for the device list in support.
 *
 * Optional to the API and cosmetic here — nothing is routed by it. It exists so
 * "which of my three registrations is this laptop?" has an answer that is not a
 * row of identical `WEB` entries. Best effort from the user agent, which lies
 * about almost everything except the browser family.
 */
export function describeThisBrowser(): string {
  if (typeof navigator === 'undefined') return 'Browser'
  const agent = navigator.userAgent

  const browser =
    /Edg\//.test(agent) ? 'Edge'
    : /OPR\//.test(agent) ? 'Opera'
    : /Firefox\//.test(agent) ? 'Firefox'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : 'Browser'

  const os =
    /Windows/.test(agent) ? 'Windows'
    : /Android/.test(agent) ? 'Android'
    : /(iPhone|iPad|iPod)/.test(agent) ? 'iOS'
    : /Mac OS X/.test(agent) ? 'macOS'
    : /Linux/.test(agent) ? 'Linux'
    : null

  return os ? `${browser} on ${os}` : browser
}
