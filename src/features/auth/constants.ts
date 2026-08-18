/** Blank login form — react-hook-form defaultValues. */
export const EMPTY_LOGIN_FORM = {
  email: '',
  password: '',
} as const

/** Where a successful sign-in lands. */
export const AFTER_LOGIN_PATH = '/chat'

/** What the login screen says about how the last session ended. */
export const SIGN_OUT_MESSAGES = {
  'session-lost': 'You were signed out — this account signed in on another device.',
  suspended: 'Your Talk access is suspended. Ask your administrator to restore it.',
} as const
