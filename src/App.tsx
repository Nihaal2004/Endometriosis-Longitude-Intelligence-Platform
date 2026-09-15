import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { PERSONAS, getPersona } from './data/personas'
import { MY_RECORD_ID, useApp } from './ui/store'
import Lock from './ui/Lock'
import Today from './ui/screens/Today'
import Patterns from './ui/screens/Patterns'
import Timeline from './ui/screens/Timeline'
import Brief from './ui/screens/Brief'
import Validation from './ui/screens/Validation'
import Method from './ui/screens/Method'

const NAV = [
  { to: '/today', label: 'Today' },
  { to: '/patterns', label: 'Patterns' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/brief', label: 'Brief' },
  { to: '/validation', label: 'Validation' },
  { to: '/method', label: 'Method' },
]

function PersonaSwitcher() {
  const personaId = useApp((s) => s.personaId)
  const setPersona = useApp((s) => s.setPersona)
  const deleteMyRecord = useApp((s) => s.deleteMyRecord)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const onMe = personaId === MY_RECORD_ID
  const demoPersona = onMe ? null : getPersona(personaId)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setPersona(MY_RECORD_ID)}
          className="focus-ring rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors"
          style={{
            background: onMe ? 'var(--ink)' : 'transparent',
            color: onMe ? 'var(--ground)' : 'var(--ink-secondary)',
            border: `1px solid ${onMe ? 'var(--ink)' : 'var(--hairline-strong)'}`,
          }}
          aria-pressed={onMe}
        >
          My record
        </button>

        <span className="mx-1.5 h-4 w-px" style={{ background: 'var(--hairline-strong)' }} />

        <span className="mr-1 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
          Demo patients (synthetic)
        </span>
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPersona(p.id)}
            className="focus-ring rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors"
            style={{
              background: p.id === personaId ? 'var(--ink)' : 'transparent',
              color: p.id === personaId ? 'var(--ground)' : 'var(--ink-secondary)',
              border: `1px solid ${p.id === personaId ? 'var(--ink)' : 'var(--hairline-strong)'}`,
            }}
            aria-pressed={p.id === personaId}
          >
            {p.name}
            <span className="ml-1.5 opacity-60">{p.age}</span>
          </button>
        ))}
      </div>

      {onMe ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="max-w-2xl text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Your own record. Nothing here is synthetic — it starts empty and only contains what you log.
          </p>
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="focus-ring text-[12px] underline shrink-0"
              style={{ color: 'var(--ink-muted)' }}
            >
              Delete my data
            </button>
          ) : (
            <span className="flex shrink-0 items-center gap-2 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
              Permanently erase everything you've logged?
              <button
                onClick={() => {
                  deleteMyRecord()
                  setConfirmingDelete(false)
                }}
                className="focus-ring rounded-full px-2.5 py-1 font-medium"
                style={{ background: 'var(--ink)', color: 'var(--ground)', border: 'none' }}
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="focus-ring underline"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      ) : (
        <p className="max-w-2xl text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {demoPersona?.demonstrates}
        </p>
      )}
    </div>
  )
}

function ThemeToggle() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const label = theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'

  return (
    <button
      onClick={() => setTheme(next)}
      className="focus-ring rounded-full px-3 py-1.5 text-[12.5px]"
      style={{ border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--ink-secondary)' }}
      title={`Theme: ${label}. Click to change.`}
    >
      {label}
    </button>
  )
}

function AppShell() {
  const personaId = useApp((s) => s.personaId)
  return (
    <div style={{ minHeight: '100vh', background: 'var(--ground)' }}>
      <header
        className="no-print sticky top-0 z-30"
        style={{
          background: 'color-mix(in srgb, var(--ground) 88%, transparent)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div className="mx-auto w-full max-w-6xl px-5 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span
                aria-hidden
                style={{
                  width: 10, height: 10, borderRadius: 999,
                  background: 'var(--bleed)', display: 'inline-block',
                }}
              />
              <span className="display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
                MedTrace
              </span>
              <span className="hidden text-[12px] sm:inline" style={{ color: 'var(--ink-muted)' }}>
                longitudinal symptom intelligence
              </span>
            </div>
            <ThemeToggle />
          </div>

          <nav className="mt-3 flex gap-1 overflow-x-auto pb-0.5">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className="focus-ring shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors"
                style={({ isActive }) => ({
                  color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
                  background: isActive ? 'var(--surface-sunken)' : 'transparent',
                  textDecoration: 'none',
                })}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="no-print mx-auto w-full max-w-6xl px-5 pt-5">
        <PersonaSwitcher />
      </div>

      <main className="print-full mx-auto w-full max-w-6xl px-5 pb-24 pt-5">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          {/* Keyed on personaId: local form state (bleeding, pain, narrative text...)
              must reset when switching persona, not carry over from whichever record
              was active a moment ago. */}
          <Route path="/today" element={<Today key={personaId} />} />
          <Route path="/patterns" element={<Patterns />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/method" element={<Method />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
    </div>
  )
}

/**
 * Gates the whole app behind the passphrase lock (crypto.ts, Lock.tsx) — the zustand
 * store's persisted state is never touched until a passphrase has been set or
 * validated, so AppShell only ever mounts once there's a key to decrypt with.
 */
export default function App() {
  const [unlocked, setUnlocked] = useState(false)
  if (!unlocked) return <Lock onUnlocked={() => setUnlocked(true)} />
  return <AppShell />
}
