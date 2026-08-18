import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'
import { env } from '@/config/env'

/**
 * Symmetric encryption for anything that leaves memory — persisted store
 * payloads and URL `?data=` tokens. Not a security boundary against a
 * determined local attacker; it keeps tokens and ids out of plain sight.
 */
export function encryptText(value: string): string {
  return AES.encrypt(value, env.VITE_APP_ENCRYPT_KEY).toString()
}

export function decryptText(cipher: string): string | null {
  try {
    const plain = AES.decrypt(cipher, env.VITE_APP_ENCRYPT_KEY).toString(Utf8)
    return plain || null
  } catch {
    return null
  }
}

/** URL-safe wrapper used for route search params — see the `?data=` rule. */
export function encryptId(id: string | number): string {
  return encodeURIComponent(encryptText(String(id)))
}

export function decryptId(token: string | undefined | null): string | null {
  if (!token) return null
  return decryptText(decodeURIComponent(token))
}
