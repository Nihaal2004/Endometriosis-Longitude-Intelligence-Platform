import { useState } from 'react'
import { useApp } from '../store'
import { PERSONAS } from '../../data/personas'

export default function Auth() {
  const busy = useApp(s => s.busy)
  const error = useApp(s => s.error)
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [recovery, setRecovery] = useState('')
  const [storage, setStorage] = useState(false)
  const [analysis, setAnalysis] = useState(false)
  const [trialOpen, setTrialOpen] = useState(false)
  const [trialAccepted, setTrialAccepted] = useState(false)
  const [localError, setLocalError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLocalError('')
    if (mode !== 'login' && password !== confirmation) { setLocalError('Your passwords do not match.'); return }
    try { await useApp.getState().authenticate(mode, { username, password, displayName, storageConsent: storage, analysisConsent: analysis, recoveryCode: recovery }) } catch {}
  }
  return <div className="auth-page">
    <section className="auth-story"><div className="brand"><span className="brand-mark">m</span>medtrace<span className="local-badge">LOCAL</span></div>
      <div><span className="eyebrow">YOUR HEALTH, WITH CONTEXT</span><h1>Make your story<br />easier to tell.</h1><p>Small daily check-ins. A clearer view of your symptoms. A considered summary for your next clinical visit.</p>
        <div className="auth-benefits"><span>01 <b>Record what matters</b></span><span>02 <b>Understand changes over time</b></span><span>03 <b>Arrive with a useful history</b></span></div>
      </div>
      <p className="auth-footnote">Your account and records stay on this computer. MedTrace helps organize patient-reported information; it does not diagnose conditions.</p>
    </section>
    <section className="auth-entry">
      {!trialOpen ? <><div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setLocalError('') }}>Sign in</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setLocalError('') }}>Create account</button></div>
        <h2>{mode === 'login' ? 'Welcome back.' : mode === 'recover' ? 'Recover your account.' : 'A space for your health history.'}</h2>
        <p>{mode === 'login' ? 'Continue your record on this computer.' : mode === 'recover' ? 'Use the recovery code you saved when registering.' : 'Start with an account, then set up your health profile.'}</p>
        <form className="app-form" onSubmit={submit}><fieldset disabled={busy}>
          {mode === 'register' && <label>What should we call you?<input required maxLength={80} autoComplete="given-name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>}
          <label>Username<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="Your local username" /></label>
          {mode === 'recover' && <label>Recovery code<input required value={recovery} onChange={e => setRecovery(e.target.value)} autoComplete="off" /></label>}
          <label>{mode === 'recover' ? 'New password' : 'Password'}<input required type="password" minLength={mode === 'login' ? undefined : 10} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
          {mode !== 'login' && <label>Confirm password<input required type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
          {mode === 'register' && <div className="consent-box"><label className="inline-check"><input required type="checkbox" checked={storage} onChange={e => setStorage(e.target.checked)} />Store my health record locally on this computer.</label><label className="inline-check"><input type="checkbox" checked={analysis} onChange={e => setAnalysis(e.target.checked)} />Analyse my observations to show patterns and prepare summaries.</label><p>You can change analysis and report permissions in Settings. Nothing is sent to a cloud service.</p></div>}
          {(localError || error) && <p role="alert" className="form-error">{localError || error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in →' : mode === 'recover' ? 'Reset password' : 'Create my account →'}</button>
        </fieldset></form>
        {mode === 'login' && <button className="text-button" onClick={() => setMode('recover')}>Forgot your password?</button>}
        <div className="auth-divider">New to symptom tracking?</div><button className="secondary-button" onClick={() => setTrialOpen(true)}>Explore a trial session</button>
      </> : <><button className="text-button" onClick={() => setTrialOpen(false)}>← Back to sign in</button><h2>See how MedTrace works.</h2><p>Explore an example patient's journey. Trial records are separate from personal accounts and are removed when the session ends or expires.</p>
        <label className="inline-check"><input type="checkbox" checked={trialAccepted} onChange={e => setTrialAccepted(e.target.checked)} />Use fictional records for local logging, analysis, and report previews.</label>
        <div className="trial-choices">{PERSONAS.map(p => <button disabled={busy || !trialAccepted} key={p.id} onClick={() => { void useApp.getState().startTrial(p.id).catch(() => {}) }}><span className="avatar">{p.name[0]}</span><span><b>{p.name}'s story</b><small>{p.tagline}</small></span><span>→</span></button>)}</div>
        {error && <p role="alert" className="form-error">{error}</p>}
      </>}
      <p className="auth-local-note">No internet account. No external API keys. Local sign-in only.</p>
    </section>
  </div>
}
