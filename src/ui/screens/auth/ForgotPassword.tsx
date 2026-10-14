import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout, Field, isPlausibleEmail } from './AuthLayout'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isPlausibleEmail(email)) return setError('Enter the email address you registered with.')
    setBusy(true)
    const result = await sendPasswordReset(email)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If an account exists for that address, a link to set a new password is on its way. Open it on this device."
      >
        <Link to="/login" className="btn btn-ghost focus-ring w-full">
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we’ll send you a link to set a new one.">
      <form onSubmit={submit} noValidate>
        <Field label="Email">
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {error && (
          <p className="notice notice-error mb-4" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary focus-ring w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-6 text-center text-[14px]">
        <Link to="/login" className="link">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
