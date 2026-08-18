import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '@/stores/auth-store'
import { useLogin } from '../api/use-auth'
import { loginSchema, type LoginFormValues } from '../schemas'
import { AFTER_LOGIN_PATH, EMPTY_LOGIN_FORM, SIGN_OUT_MESSAGES } from '../constants'

/**
 * All login-screen logic. `login-page.tsx` and `login-form.tsx` only lay out
 * markup — this owns the form, the submit and the redirect.
 */
export function useLoginForm() {
  const navigate = useNavigate()
  const { mutate, isPending, failure } = useLogin()
  const signOutReason = useAuthStore((s) => s.signOutReason)
  const clearSignOutReason = useAuthStore((s) => s.clearSignOutReason)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { ...EMPTY_LOGIN_FORM },
  })

  // Why the last session ended is worth saying once. It is cleared as soon as
  // it has been read, so it can't reappear over an unrelated failed attempt.
  const notice =
    signOutReason && signOutReason !== 'user' ? SIGN_OUT_MESSAGES[signOutReason] : null

  useEffect(() => {
    if (notice) return () => clearSignOutReason()
  }, [notice, clearSignOutReason])

  const onSubmit = form.handleSubmit(async (values) => {
    const ok = await mutate(values)
    if (ok) navigate(AFTER_LOGIN_PATH, { replace: true })
  })

  return { form, onSubmit, isPending, failure, notice }
}
