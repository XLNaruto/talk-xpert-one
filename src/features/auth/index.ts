/**
 * The auth feature's public surface. Everything outside `features/auth`
 * imports from here — never from a deep path.
 */
export { LoginPage } from './pages/login-page'
export { AccountSheet } from './components/account-sheet'
export { useLogin, useLogout, useRefreshIdentity } from './api/use-auth'
export { AFTER_LOGIN_PATH } from './constants'
export { logoutCopy, logoutEverywhereCopy } from './lib/logout-copy'
export type { ActiveSessions, AuthSession, LoginValues, TalkIdentity } from './types'
