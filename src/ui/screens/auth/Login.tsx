import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PERSONAS } from '../../../data/personas'
import { useAuth } from '../../auth/AuthProvider'
import { useApp } from '../../store'
import { AuthLayout, Field, PasswordInput, isPlausibleEmail } from './AuthLayout'

export default function Login() {
  const { signIn, configured, notice, clearNotice } = useAuth()
  const enterDemo = useApp((s) => s.enterDemo)
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isPlausibleEmail(email)) return setError('Enter the email address you registered with.')
    if (!password) return setError('Enter your password.')
    setBusy(true)
    const result = await signIn(email, password)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    navigate('/today', { replace: true })
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Your record, your patterns, and a report you can take to your next appointment."
      footer={<DemoPicker onPick={(id) => { enterDemo(id); navigate('/today') }} />}
    >
      {notice && (
        <p className="notice notice-info mb-5" role="status">
          {notice}{' '}
          <button type="button" className="link text-[13px]" onClick={clearNotice}>Dismiss</button>
        </p>
      )}

      {!configured && (
        <p className="notice notice-info mb-5">
          Accounts aren’t set up in this build. You can still explore a demo patient below.
        </p>
      )}

      <form onSubmit={submit} noValidate>
        <Field label="Email">
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!configured}
          />
        </Field>

        <Field label="Password">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>

        <div className="-mt-1 mb-5 text-right">
          <Link to="/forgot-password" className="link text-[13.5px]">
            Forgot password?
          </Link>
        </div>

        {error && (
          <p className="notice notice-error mb-4" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary focus-ring w-full" disabled={busy || !configured}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
        New here?{' '}
        <Link to="/register" className="link">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}

function DemoPicker({ onPick }: { onPick: (personaId: string) => void }) {
  return (
    <section className="rounded-2xl p-5" style={{ background: 'var(--surface-sunken)' }}>
      <h2 className="text-[15px]" style={{ fontFamily: 'var(--font-ui)', fontWeight: 700 }}>
        Just looking?
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        Explore with a synthetic demo patient — no account, nothing stored online.
      </p>
      <div className="mt-3 space-y-2">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className="focus-ring flex w-full items-center justify-between rounded-xl px-4 py-3 text-left"
            style={{ background: 'var(--surface)', border: '1px solid var(--hairline)' }}
          >
            <span>
              <span className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                {p.name}, {p.age}
              </span>
              <span className="block text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                {p.tagline}
              </span>
            </span>
            <span aria-hidden style={{ color: 'var(--ink-muted)' }}>→</span>
          </button>
        ))}
      </div>
    </section>
  )
}
