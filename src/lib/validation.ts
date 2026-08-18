import { z } from 'zod'

/** Field-level zod primitives shared by every feature schema. */
export const emailField = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Enter a valid email')

export const passwordField = z.string().min(8, 'Password must be at least 8 characters')

export const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`)

/**
 * A zod error, regrouped as one message per field.
 *
 * Forms that hand-roll `safeParse` instead of going through the react-hook-form
 * resolver need this to put a message under the box it is about — taking
 * `issues[0]` puts every message in one place, which reads as being about
 * whichever field it happens to sit next to.
 *
 * First issue per field wins: a box shows one reason at a time, and zod can
 * report several for the same one.
 */
export function fieldErrors<K extends string>(error: z.ZodError): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key !== 'string') continue
    if (result[key as K] === undefined) result[key as K] = issue.message
  }
  return result
}
