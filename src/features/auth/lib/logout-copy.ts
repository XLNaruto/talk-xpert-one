/**
 * What a sign-out asks before it happens.
 *
 * There are two ways out and two places to reach them — the account sheet's
 * footer and the sidebar menu — so the question lives here rather than beside
 * either button. Kept pure: it takes the count and answers strings.
 */
import { CLIENT_PLATFORM } from '@/lib/platform'
import { platformLabel } from './platform-display'

export interface LogoutCopy {
  title: string
  message: string
  confirmLabel: string
  tone: 'destructive'
}

/**
 * This session only. The other devices are the reassurance, so they are named.
 *
 * `verb` matches the wording of the control that asked — the sidebar menu says
 * "Log out", the account sheet says "Sign out" — because a dialog that renames
 * the action reads as a different action.
 */
export function logoutCopy(verb: 'Log out' | 'Sign out' = 'Sign out'): LogoutCopy {
  const here = platformLabel(CLIENT_PLATFORM).toLowerCase()
  return {
    title: `${verb} of this ${here}?`,
    message: `Your other devices stay signed in. Signing back in on this ${here} needs your password.`,
    confirmLabel: verb,
    tone: 'destructive',
  }
}

/**
 * Every session. Talk allows one live session per operating system, so naming
 * how many OTHERS go with it is the difference between "just me" and "the phone
 * too" — the whole reason to pick this over the everyday button. `otherDevices`
 * is 0 when the session list could not be read, and the copy says less rather
 * than guessing.
 */
export function logoutEverywhereCopy(otherDevices: number): LogoutCopy {
  const here = platformLabel(CLIENT_PLATFORM).toLowerCase()
  const others =
    otherDevices === 1
      ? 'the other signed-in device'
      : `all ${otherDevices} other signed-in devices`
  return {
    title: 'Sign out on every device?',
    message:
      otherDevices > 0
        ? `This ends this ${here} and ${others}. Signing back in needs your password.`
        : 'This ends every session on your account. Signing back in needs your password.',
    confirmLabel: 'Sign out everywhere',
    tone: 'destructive',
  }
}
