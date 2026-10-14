import { useNavigate } from 'react-router-dom'
import { NOTICE_VERSION, PRIVACY_SECTIONS } from '../privacy'
import { Wordmark } from './auth/AuthLayout'

export default function Privacy() {
  const navigate = useNavigate()
  return (
    <div className="safe-top mx-auto w-full max-w-2xl px-5 pb-16 pt-10">
      <div className="flex items-center justify-between">
        <Wordmark size={20} />
        <button className="btn btn-ghost focus-ring" style={{ minHeight: 38 }} onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
      <h1 className="mt-8" style={{ fontSize: 30 }}>
        Privacy notice
      </h1>
      <p className="mt-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Version {NOTICE_VERSION}
      </p>
      {PRIVACY_SECTIONS.map((s) => (
        <section key={s.heading} className="mt-7">
          <h2 style={{ fontSize: 19 }}>{s.heading}</h2>
          {s.body.map((p) => (
            <p key={p} className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  )
}
