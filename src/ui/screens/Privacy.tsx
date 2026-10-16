import { useNavigate } from 'react-router-dom'
import { PrivacyNoticeText } from '../PrivacyDialog'
import { Wordmark } from './auth/AuthLayout'

export default function Privacy() {
  const navigate = useNavigate()
  // Opened directly (a bookmark, a new tab) there is nothing to go back to.
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }))
  return (
    <div className="safe-top mx-auto w-full max-w-2xl px-5 pb-16 pt-10">
      <div className="flex items-center justify-between">
        <Wordmark size={20} />
        <button className="btn btn-ghost focus-ring" style={{ minHeight: 38 }} onClick={back}>
          Back
        </button>
      </div>
      <h1 className="mt-8 mb-2" style={{ fontSize: 30 }}>
        Privacy notice
      </h1>
      <PrivacyNoticeText />
    </div>
  )
}
