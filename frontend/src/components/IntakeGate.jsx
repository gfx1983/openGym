import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'

// A trainer's new client is taken to the questionnaire once, the first time the app is ready. Left
// unfinished, it stays a reminder on the home screen. Never in the trainer's workspace or mid-workout.
export default function IntakeGate() {
  const nav = useNavigate()
  const ready = useStore(s => s.ready)
  const userId = useStore(s => s.user?.id)
  useEffect(() => {
    if (!ready || !userId) return
    const st = useStore.getState()
    if (st.tourSandbox || st.S.active) return
    let gone = false
    api('/api/account/intake').then(d => {
      const now = useStore.getState()
      if (gone || !d?.trainer || d.shown || d.intake?.shortDoneAt || now.tourSandbox || now.S.active) return
      api('/api/account/intake/shown', { method: 'POST', body: '{}' }).catch(() => {})
      nav('/intake')
    }).catch(e => console.error('intake', e))
    return () => { gone = true }
  }, [ready, userId]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
