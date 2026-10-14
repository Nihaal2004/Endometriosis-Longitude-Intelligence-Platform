import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout, Field, PasswordInput, passwordProblem } from './AuthLayout'

/** Reached from the password-reset email, after Supabase has signed the patient in for recovery. */
export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const passwordError = touched ? passwordProblem(password) : null
  const confirmError = touched && confirm !== password ? 'The two passwords don’t match.' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (passwordProblem(password) || confirm !== password) return
    setBusy(true)
    const result = await updatePassword(password)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    navigate('/today', { replace: true })
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} noValidate>
        <Field label="New password" error={passwordError} hint="At least 8 characters, with letters and numbers.">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" invalid={Boolean(passwordError)} />
        </Field>
        <Field label="Confirm new password" error={confirmError}>
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={Boolean(confirmError)} />
        </Field>
        {error && (
          <p className="notice notice-error mb-4" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary focus-ring w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </AuthLayout>
  )
}
