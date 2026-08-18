import { MessagesSquare } from 'lucide-react'
import { LoginForm } from '../components/login-form'

export function LoginPage() {
  return (
    <div className="auth-rise auth-glass w-full max-w-md rounded-2xl px-7 py-9 sm:px-9">
      <div className="text-center">
        <span className="auth-mark inline-flex size-14 items-center justify-center rounded-2xl">
          <MessagesSquare className="size-7" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Sign in to your XpertOne account to continue your conversations.
        </p>
      </div>

      <div className="mt-7">
        <LoginForm />
      </div>

      <p className="mt-7 flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
        <MessagesSquare className="mt-px size-4 shrink-0 text-primary" aria-hidden />
        Talk allows one live session per device. Signing in here ends any other browser
        session on this machine.
      </p>
    </div>
  )
}
