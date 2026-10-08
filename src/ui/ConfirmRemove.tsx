import { useState } from 'react'
import { useApp } from './store'

export default function ConfirmRemove({ label, remove }: { label: string; remove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const busy = useApp(s => s.busy)
  return <span className="flex items-center gap-2 no-print">
    {!confirming ? <button type="button" disabled={busy} onClick={() => setConfirming(true)}>Remove {label}</button> : <>
      <button type="button" disabled={busy} onClick={() => { void remove().then(() => setConfirming(false)).catch(() => {}) }}>Confirm removal</button>
      <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    </>}
  </span>
}
