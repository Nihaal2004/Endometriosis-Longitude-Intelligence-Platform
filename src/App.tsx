import { Component, useEffect, useRef, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { PERSONAS } from './data/personas'
import { useApp, localDate, api } from './ui/store'
import Auth from './ui/screens/Auth'
import Home from './ui/screens/Home'
import Settings from './ui/screens/Settings'
import Today from './ui/screens/Today'
import Patterns from './ui/screens/Patterns'
import Timeline from './ui/screens/Timeline'
import Brief from './ui/screens/Brief'
import Validation from './ui/screens/Validation'
import Method from './ui/screens/Method'
import Profile from './ui/screens/Profile'
import Events from './ui/screens/Events'
import Reports from './ui/screens/Reports'

const NAV = [['/', 'Overview'], ['/today', 'Daily check-in'], ['/patterns', 'Insights'], ['/timeline', 'My timeline'], ['/events', 'Treatments & visits'], ['/brief', 'Prepare a clinical visit'], ['/reports', 'My reports'], ['/profile', 'Health profile'], ['/settings', 'Settings & privacy']]
class ScreenBoundary extends Component<{children: ReactNode}, {failed:boolean}> {
  state = {failed:false}
  static getDerivedStateFromError() { return {failed:true} }
  render() { return this.state.failed ? <div className="card p-6" role="alert"><h1>Unable to display this record</h1><p>Reload your record to continue.</p><button onClick={()=>void useApp.getState().initialize()}>Reload record</button></div> : this.props.children }
}
function AnalysisPermission({children}:{children:ReactNode}) {
  const allowed=useApp(s=>s.consents.health_analysis)
  return allowed ? children : <section className="card p-6"><h1>Analysis is paused</h1><p>Your observations remain available. Enable analysis in your privacy settings to see insights and prepare new reports.</p><NavLink to="/settings">Manage permissions →</NavLink></section>
}
export default function App() {
  const state=useApp()
  const reminded=useRef('')
  const lastActivity=useRef(Date.now())
  useEffect(()=>{document.documentElement.dataset.theme='light';void useApp.getState().initialize()},[])
  useEffect(()=>{
    const tick=()=>{
      const record=useApp.getState().record
      const date=localDate(), d=new Date(), time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      if(record?.profile.reminderTime===time && reminded.current!==date && !record.days.some(day=>day.date===date) && 'Notification' in window && Notification.permission==='granted') {
        reminded.current=date; new Notification('MedTrace', {body:'A moment for your daily check-in, whenever you are ready.'})
      }
    }
    const timer=window.setInterval(tick,30000); return ()=>window.clearInterval(timer)
  },[])
  useEffect(()=>{
    if(!state.user)return
    lastActivity.current=Date.now()
    const activity=()=>{lastActivity.current=Date.now()}
    for(const event of ['pointerdown','keydown','scroll'])window.addEventListener(event,activity,{passive:true})
    const timer=window.setInterval(()=>{
      if(Date.now()-lastActivity.current>=30*60*1000){
        if(!useApp.getState().busy)void useApp.getState().logout().catch(()=>useApp.getState().acceptSession({user:null}))
      }else if(!document.hidden)void api('/auth/ping').catch(()=>{})
    },60000)
    return()=>{window.clearInterval(timer);for(const event of ['pointerdown','keydown','scroll'])window.removeEventListener(event,activity)}
  },[state.user?.kind,state.personaId])
  if(!state.ready) return <div className="connection-page"><div className="card p-8"><h1>Opening your local workspace</h1><p>{state.error || 'Connecting to MedTrace on this computer…'}</p><button disabled={state.busy} onClick={()=>void state.initialize()}>Reconnect</button></div></div>
  if(!state.user || !state.record) return <Auth />
  const trial=state.user.kind==='trial'
  const setup=!trial && !state.record.profile.onboarded
  return <div className="app-shell">
    <aside className="app-sidebar no-print"><NavLink to="/" className="brand"><span className="brand-mark">m</span>medtrace</NavLink><span className="local-badge">YOUR LOCAL WORKSPACE</span>
      <nav aria-label="Main navigation">{NAV.map(([to,label])=><NavLink key={to} to={to} end={to==='/'}>{label}</NavLink>)}</nav>
      <div className="sidebar-footer"><span className="privacy-dot" /> Stored on this computer<NavLink to="/method">How insights work</NavLink>{trial&&<NavLink to="/validation">Example validation</NavLink>}<button disabled={state.busy} onClick={()=>void state.logout().catch(()=>{})}>{trial?'End trial & erase sample':'Sign out'}</button></div>
    </aside>
    <div className="app-workspace"><header className="app-topbar no-print"><div><b>{state.record.profile.displayName}</b><span>{trial?'Fictional patient · trial session':'Personal health workspace'}</span></div><label>View <select aria-label="Analysis period" value={state.windowDays} onChange={e=>state.setWindowDays(Number(e.target.value))}>{[30,92,188,365].map(n=><option key={n} value={n}>{n} days</option>)}</select></label></header>
      {trial&&<div className="trial-banner no-print"><div><b>Explore a trial session</b><span>Fictional data only. Sample records are erased when you end this trial.</span></div><div>{PERSONAS.map(p=><button disabled={state.busy} key={p.id} aria-pressed={state.demoId===p.id} onClick={()=>void state.selectDemo(p.id).catch(()=>{})}>{p.name}</button>)}</div></div>}
      <main className="app-main print-full">{state.error&&<div className="notice error no-print" role="alert">{state.error} <button disabled={state.busy} onClick={()=>void state.initialize()}>Reload saved record</button></div>}{state.status&&<p className="save-status no-print" role="status">{state.status}</p>}
      <ScreenBoundary key={`${state.personaId}:${state.generation}`}><Routes>
        <Route path="/setup" element={<Profile create />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/" element={setup?<Navigate to="/setup" replace/>:<Home />} />
        <Route path="/today" element={setup?<Navigate to="/setup" replace/>:<Today />} />
        <Route path="/events" element={setup?<Navigate to="/setup" replace/>:<Events />} />
        <Route path="/patterns" element={setup?<Navigate to="/setup" replace/>:<AnalysisPermission><Patterns /></AnalysisPermission>} />
        <Route path="/timeline" element={setup?<Navigate to="/setup" replace/>:<AnalysisPermission><Timeline /></AnalysisPermission>} />
        <Route path="/brief" element={setup?<Navigate to="/setup" replace/>:<AnalysisPermission><Brief /></AnalysisPermission>} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/method" element={<AnalysisPermission><Method /></AnalysisPermission>} />
        <Route path="/validation" element={trial?<Validation />:<Navigate to="/" replace/>} />
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes></ScreenBoundary></main>
    </div>
    {state.recoveryCode&&<div className="dialog-backdrop no-print"><section className="card recovery-dialog p-8" role="dialog" aria-modal="true" aria-labelledby="recovery-title"><span className="eyebrow">SAVE THIS SOMEWHERE PRIVATE</span><h2 id="recovery-title">Your account recovery code</h2><p>This code lets you reset your password locally. We cannot email a reset link. Keep it separate from this computer.</p><code>{state.recoveryCode}</code><button className="primary-button" onClick={state.clearRecovery}>I have saved my recovery code</button></section></div>}
  </div>
}
