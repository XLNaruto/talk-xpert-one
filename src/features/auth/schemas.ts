import { z } from 'zod'
import { emailField } from '@/lib/validation'

/**
 * A Talk credential is issued by the tenant, so the client does not get to have
 * an opinion about its shape beyond "something was typed" — a minimum length
 * here would reject a valid short password the administrator chose.
 */
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
})

export type LoginFormValues = z.infer<typeof loginSchema>
