import { Link } from 'react-router-dom'
import { useAnalysis, useApp, useRecord, localDate } from '../store'
import { symptomLabel } from '../../engine/symptoms'

function Highlights() {
  const { ctx, patterns } = useAnalysis()
  const labels = Object.fromEntries((ctx.record.customSymptoms ?? []).map(s => [s.id, s.label]))
  const concerns = [...ctx.features.values()].filter(f => f.daysPresent > 0).sort((a,b) => b.daysPresent - a.daysPresent).slice(0, 3)
  return <section className="card p-6"><div className="section-heading"><div><span className="eyebrow">YOUR RECORD IN CONTEXT</span><h2>What your observations show</h2></div><Link to="/patterns">Explore insights →</Link></div>
    {concerns.length === 0 ? <div className="empty-state"><span>◇</span><h3>Your history starts here.</h3><p>After a few check-ins, you will see descriptive counts. Patterns appear only when enough observations support them.</p></div> : <div className="home-metrics">{concerns.map(f => <div key={f.symptomId}><span>{symptomLabel(f.symptomId, labels)}</span><strong>{f.daysPresent}<small>days</small></strong><p>Recorded on {f.observedDays} observed days</p></div>)}</div>}
    <p className="muted">{ctx.loggedDays} days logged in this window · {Math.round(ctx.coverage * 100)}% coverage · {patterns.findings.filter(f => f.passed).length} supported findings. Missing days stay unknown.</p>
  </section>
}
export default function Home() {
  const record = useRecord()
  const analysis = useApp(s => s.consents.health_analysis)
  const date = localDate()
  const today = record.days.find(d => d.date === date)
  const trial = useApp(s => s.user?.kind === 'trial')
  return <div className="space-y-6"><div className="page-heading"><span className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' })}</span><h1>Good to see you, {record.profile.displayName.split(' ')[0]}.</h1><p>A little continuity today can make your next conversation easier.</p></div>
    <section className="home-hero"><div><span className="eyebrow">YOUR DAILY CHECK-IN</span><h2>{today ? 'Your day is on record.' : 'How are you feeling today?'}</h2><p>{today ? 'You can revisit your answers whenever you need to.' : 'A short check-in captures pain, bleeding, and how your day felt. Leave anything you are unsure about unanswered.'}</p><Link className="primary-button" to="/today" onClick={() => useApp.getState().setDate(date)}>{today ? 'Review today’s entry' : 'Start today’s check-in'} →</Link></div><div className="hero-orbit" aria-hidden><span>you</span><i /><i /><i /></div></section>
    {analysis ? <Highlights /> : <section className="card p-6"><h2>Your record, at your pace.</h2><p>Analysis is paused in your privacy settings. You can still view and record observations.</p><Link to="/settings">Manage analysis permission →</Link></section>}
    <div className="home-actions"><Link to="/brief"><span>↗</span><h3>Prepare for a visit</h3><p>Choose what to include, review the evidence, and create your clinical report.</p></Link><Link to="/events"><span>＋</span><h3>Add context</h3><p>Record a treatment change, investigation, or healthcare appointment.</p></Link><Link to="/timeline"><span>◷</span><h3>See your journey</h3><p>Bring symptoms, treatments, and healthcare events into one view.</p></Link></div>
    <section className="card p-6"><div className="section-heading"><h2>Recent check-ins</h2><Link to="/today">View or add entries →</Link></div>{record.days.length === 0 && <p className="muted">No entries yet. Start with today.</p>}{[...record.days].slice(-5).reverse().map(d => <Link className="history-row" key={d.date} to="/today" onClick={() => useApp.getState().setDate(d.date)}><span>{d.date}</span><span>{Object.values(d.symptoms).filter(o=>o.state === 'present').length} symptoms recorded</span><span>{d.depth ?? 'standard'} →</span></Link>)}</section>
    {trial && <p className="muted">These are fictional examples. End the trial to create your own local account.</p>}
  </div>
}
