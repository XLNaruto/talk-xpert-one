/**
 * The notifications feature's public surface — push registration and the seam
 * that hands a delivered push to whoever knows what the event inside it means.
 *
 * `features/chat` subscribes to `onPushEvent` / `onPushClick`; nothing here
 * imports chat, so the two do not depend on each other in a circle.
 */
export { PushPermissionPrompt } from './components/push-permission-prompt'
export { usePushNotifications } from './hooks/use-push-notifications'
export { usePushDevices } from './api/use-devices'
export { onPushClick, onPushEvent } from './lib/push-bus'
export { pushChatId } from './lib/push-payload'
export type { PushDevice, PushStatus, TalkPushEvent } from './types'
