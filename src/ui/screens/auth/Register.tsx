import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout, Field, PasswordInput, isPlausibleEmail, passwordProblem } from './AuthLayout'

export default function Register() {
  const { signUp, configured } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [adult, setAdult] = useState(false)
  const [readNotice, setReadNotice] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const emailError = touched && !isPlausibleEmail(email) ? 'Enter a valid email address.' : null
  const passwordError = touched ? passwordProblem(password) : null
  const confirmError = touched && confirm !== password ? 'The two passwords don’t match.' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (!isPlausibleEmail(email) || passwordProblem(password) || confirm !== password) return
    if (!adult) return setError('MedTrace is currently open to people aged 18 and over.')
    if (!readNotice) return setError('Please read and accept the privacy notice to continue.')

    setBusy(true)
    const result = await signUp(email, password, adult)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    if (result.needsConfirmation) {
      navigate(`/check-email?email=${encodeURIComponent(email.trim())}`, { replace: true })
    } else {
      navigate('/onboarding', { replace: true })
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Your entries stay private to you. Nothing is shared with anyone unless you create a link to share it."
    >
      <form onSubmit={submit} noValidate>
        <Field label="Email" error={emailError}>
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(emailError) || undefined}
            disabled={!configured}
          />
        </Field>

        <Field label="Password" error={passwordError} hint="At least 8 characters, with letters and numbers.">
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={Boolean(passwordError)}
          />
        </Field>

        <Field label="Confirm password" error={confirmError}>
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={Boolean(confirmError)}
          />
        </Field>

        <div className="mt-5 space-y-3">
          <Check checked={adult} onChange={setAdult}>
            I am 18 or older.
          </Check>
          <Check checked={readNotice} onChange={setReadNotice}>
            I have read the{' '}
            <Link to="/privacy" className="link" target="_blank" rel="noopener">
              privacy notice
            </Link>{' '}
            and understand how my health information is used.
          </Check>
        </div>

        {error && (
          <p className="notice notice-error mt-5" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary focus-ring mt-6 w-full" disabled={busy || !configured}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
        Already have an account?{' '}
        <Link to="/login" className="link">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-snug" style={{ color: 'var(--ink-secondary)' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0"
        style={{ accentColor: 'var(--ink)' }}
      />
      <span>{children}</span>
    </label>
  )
}
