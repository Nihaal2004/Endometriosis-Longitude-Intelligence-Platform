import { cloneElement, useId, useState, type ReactElement, type ReactNode } from 'react'

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        style={{ width: size * 0.45, height: size * 0.45, borderRadius: 999, background: 'var(--bleed)' }}
      />
      <span className="display" style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.02em' }}>
        MedTrace
      </span>
    </div>
  )
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div
      className="safe-top flex min-h-screen flex-col items-center px-5 pb-12"
      style={{ background: 'var(--ground)' }}
    >
      <div className="w-full max-w-[420px] pt-10 sm:pt-16">
        <Wordmark />
        <h1 className="mt-8" style={{ fontSize: 30, lineHeight: 1.15 }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {subtitle}
          </p>
        )}
        <div className="mt-7">{children}</div>
        {footer && <div className="mt-8">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * A labelled form field. The label is tied to its control by id, and the hint or
 * error by aria-describedby, so a screen reader announces both with the input.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>
}) {
  const id = useId()
  const noteId = `${id}-note`
  const hasNote = Boolean(error || hint)
  return (
    <div className="mb-4">
      <label className="field-label" htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': hasNote ? noteId : undefined })}
      {error ? (
        <p id={noteId} className="mt-1.5 text-[12.5px]" style={{ color: 'var(--viz-critical)' }} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function PasswordInput({
  value,
  onChange,
  autoComplete,
  invalid,
  id,
  'aria-describedby': describedBy,
}: {
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  invalid?: boolean
  id?: string
  'aria-describedby'?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        aria-describedby={describedBy}
        className="input"
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        style={{ paddingRight: 64 }}
      />
      <button
        type="button"
        className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[12.5px] font-semibold"
        style={{ background: 'none', border: 'none', color: 'var(--ink-muted)' }}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

/** Matches the server policy in supabase/config.toml: 8+ characters, letters and digits. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one letter and one number.'
  }
  return null
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}
