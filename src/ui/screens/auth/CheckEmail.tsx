import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AuthLayout } from './AuthLayout'

const RESEND_COOLDOWN_S = 60

export default function CheckEmail() {
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const { resendConfirmation } = useAuth()
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function resend() {
    setMessage(null)
    const result = await resendConfirmation(email)
    setMessage(result.ok ? 'Sent again. It can take a minute to arrive.' : result.message)
    setCooldown(RESEND_COOLDOWN_S)
  }

  return (
    <AuthLayout
      title="Check your email"
      subtitle={
        <>
          We sent a confirmation link to <strong style={{ color: 'var(--ink)' }}>{email || 'your inbox'}</strong>.
          Open it on this device to finish creating your account.
        </>
      }
    >
      <div className="notice notice-info">
        Can’t find it? Look in spam or promotions. The link expires after 24 hours.
      </div>

      {email && (
        <button
          className="btn btn-ghost focus-ring mt-5 w-full"
          onClick={resend}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend the link'}
        </button>
      )}

      {message && (
        <p className="mt-3 text-center text-[13.5px]" style={{ color: 'var(--ink-secondary)' }} role="status">
          {message}
        </p>
      )}

      <p className="mt-8 text-center text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
        Already confirmed?{' '}
        <Link to="/login" className="link">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
