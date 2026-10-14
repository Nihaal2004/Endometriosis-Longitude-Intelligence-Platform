/**
 * App — providers, the route guard, and navigation.
 *
 * The guard runs in a fixed order, and each step exists for a reason:
 *
 *   1. Auth still loading            → splash (never flash the login screen)
 *   2. Arrived from a reset email    → choose a new password, nothing else
 *   3. Not signed in, not in demo    → public routes only
 *   4. Signed in, profile not yet on
 *      this device                   → wait for it (else a returning patient on a
 *                                      new phone would be sent through onboarding)
 *   5. Signed in, not onboarded      → onboarding
 *   6. Otherwise                     → the app
 */

import { useEffect } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { getPersona } from './data/personas'
import { AuthProvider, useAuth } from './ui/auth/AuthProvider'
import { DataProvider, useData } from './ui/data'
import { useApp } from './ui/store'
import Calendar from './ui/screens/Calendar'
import DayLog from './ui/screens/DayLog'
import Insights from './ui/screens/Insights'
import Me from './ui/screens/Me'
import Onboarding from './ui/screens/Onboarding'
import Privacy from './ui/screens/Privacy'
import Today from './ui/screens/Today'
import CheckEmail from './ui/screens/auth/CheckEmail'
import ForgotPassword from './ui/screens/auth/ForgotPassword'
import Login from './ui/screens/auth/Login'
import Register from './ui/screens/auth/Register'
import ResetPassword from './ui/screens/auth/ResetPassword'
import { Wordmark } from './ui/screens/auth/AuthLayout'

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <ThemeSync />
        <AppRoutes />
      </DataProvider>
    </AuthProvider>
  )
}

function ThemeSync() {
  const theme = useApp((s) => s.theme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])
  return null
}

function AppRoutes() {
  const auth = useAuth()
  const data = useData()

  // 1
  if (auth.loading) return <Splash />

  // 2
  if (auth.recovering) {
    return (
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<ResetPassword />} />
      </Routes>
    )
  }

  // 3
  if (data.mode === 'none') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // 4
  if (data.mode === 'account' && (!data.ready || !data.profileKnown)) {
    return <Splash offline={data.syncStatus?.offline ?? false} onRetry={() => void data.repo?.sync()} />
  }

  // 5
  if (data.mode === 'account' && !data.profileRow?.onboarded_at) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    )
  }

  // 6
  return (
    <Routes>
      <Route path="/privacy" element={<Privacy />} />
      <Route element={<Shell />}>
        <Route path="/today" element={<Today />} />
        <Route path="/log/:date" element={<DayLog />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/insights" element={<Navigate to="/insights/report" replace />} />
        <Route path="/insights/:section" element={<Insights />} />
        <Route path="/me" element={<Me />} />
      </Route>
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  )
}

function Splash({ offline = false, onRetry }: { offline?: boolean; onRetry?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <Wordmark size={24} />
      {offline ? (
        <>
          <p className="max-w-xs text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            Connect to the internet once to finish setting up this device. After that, MedTrace works offline.
          </p>
          {onRetry && <button className="btn btn-ghost focus-ring" onClick={onRetry}>Try again</button>}
        </>
      ) : (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>Loading your record…</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shell: header (desktop), bottom tab bar (phones), demo banner
// ---------------------------------------------------------------------------

const TABS = [
  { to: '/today', label: 'Today', icon: IconToday },
  { to: '/calendar', label: 'Calendar', icon: IconCalendar },
  { to: '/insights', label: 'Insights', icon: IconInsights },
  { to: '/me', label: 'Me', icon: IconMe },
]

function Shell() {
  const { mode } = useData()
  const demoPersonaId = useApp((s) => s.demoPersonaId)
  const exitDemo = useApp((s) => s.exitDemo)
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ground)' }}>
      {mode === 'demo' && demoPersonaId && (
        <div className="no-print safe-top px-5 py-2 text-center text-[12.5px]"
          style={{ background: 'var(--ink)', color: 'var(--ground)' }}>
          Demo patient — {getPersona(demoPersonaId).name}. Synthetic data, nothing saved online.{' '}
          <button className="underline underline-offset-2" style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 600 }}
            onClick={() => { exitDemo(); navigate('/login') }}>
            Leave demo
          </button>
        </div>
      )}

      <header className="no-print sticky top-0 z-30"
        style={{
          background: 'color-mix(in srgb, var(--ground) 88%, transparent)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--hairline)',
          paddingTop: mode === 'demo' ? 0 : 'env(safe-area-inset-top)',
        }}>
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3">
          <Wordmark size={20} />
          <nav className="hidden gap-1 min-[720px]:flex">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to}
                className="focus-ring rounded-lg px-3 py-1.5 text-[13.5px] font-medium"
                style={({ isActive }) => ({
                  color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
                  background: isActive ? 'var(--surface-sunken)' : 'transparent',
                  textDecoration: 'none',
                })}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="print-full mx-auto w-full max-w-6xl px-5 pb-28 pt-5 min-[720px]:pb-16">
        <Outlet />
      </main>

      <nav className="tabbar no-print" aria-label="Main">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="focus-ring">
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

// Small, quiet line icons. Stroke follows the text colour, so the active tab is
// distinguished by ink weight and label, never by colour alone.
function IconToday() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 8 8" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 10h16M9 3v4M15 3v4" strokeLinecap="round" />
    </svg>
  )
}
function IconInsights() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5 19V11M12 19V5M19 19v-6" strokeLinecap="round" />
    </svg>
  )
}
function IconMe() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" strokeLinecap="round" />
    </svg>
  )
}
