import { useState } from 'react'
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/form-field'
import { useLoginForm } from '../hooks/use-login-form'

/** Presentational only — every decision lives in `useLoginForm`. */
export function LoginForm() {
  const { form, onSubmit, isPending, failure, notice } = useLoginForm()
  const { register, formState } = form
  // Purely visual, so it stays here rather than in the hook.
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      {notice && (
        <p
          className="rounded-lg border border-border bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary-foreground"
          role="status"
        >
          {notice}
        </p>
      )}

      {/* Both fields are required, but with only two of them an asterisk on each
          is noise — the inline error says what is missing. */}
      <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-foreground/75"
            aria-hidden
          />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="auth-field h-11 bg-[var(--auth-field)] pl-9"
            {...register('email')}
          />
        </div>
      </Field>

      <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-foreground/75"
            aria-hidden
          />
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Your password"
            className="auth-field h-11 bg-[var(--auth-field)] pl-9 pr-10"
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-foreground/75 transition-colors hover:text-foreground"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      {failure && (
        <p
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
          {failure.message}
        </p>
      )}

      {/* A suspended credential can't be fixed by trying again, so the button goes. */}
      {!failure?.isSuspended && (
        <Button
          type="submit"
          disabled={isPending}
          size="lg"
          // `bg-transparent` clears the variant's flat fill so `.auth-submit`'s
          // gradient is the only paint; the utility beats the class on layer order.
          className="auth-submit h-11 w-full bg-transparent text-sm font-semibold text-[var(--auth-mark-foreground)] hover:bg-transparent"
        >
          {isPending && <Loader2 className="animate-spin" />}
          {isPending ? 'Signing in' : 'Sign in'}
        </Button>
      )}
    </form>
  )
}
