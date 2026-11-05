import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { applyWaitingPlan, wantsClientModules, setClientModules } from '../lib/trainer-plan.js'

// A client's app takes in what the trainer sent as soon as it can: at the start, on coming back to
// the foreground, and every few minutes while it is on screen, but not in the middle of a workout:
// unlocking the phone between sets must not rewrite what is being trained. Someone without a
// trainer is asked once per start and left alone.
const EVERY = 5 * 60 * 1000

export default function TrainerPlanSync() {
  const ready = useStore(s => s.ready)
  const userId = useStore(s => s.user?.id)
  useEffect(() => {
    if (!ready || !userId) return
    let busy = false, hasTrainer = true, timer
    const check = async () => {
      const st = useStore.getState()
      if (busy || !hasTrainer || document.hidden || st.tourSandbox || st.S.active) return
      busy = true
      try { hasTrainer = (await applyWaitingPlan(useStore)).trainer !== false }
      catch (e) { console.error('trainer plan', e) }
      finally { busy = false }
    }
    check()
    timer = setInterval(check, EVERY)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [ready, userId])
  // Only once the account's own copy is here: choices made on another device must decide first.
  const synced = useStore(s => s.sync?.status === 'ok' && s.sync.lastSynced > 0)
  useEffect(() => {
    if (!ready || !userId || !synced || !wantsClientModules(useStore.getState().S)) return
    let gone = false
    api('/api/account/trainer').then(d => {
      const st = useStore.getState()
      if (!gone && d?.trainer && !st.tourSandbox && wantsClientModules(st.S)) st.update(setClientModules)
    }).catch(e => console.error('client modules', e))
    return () => { gone = true }
  }, [ready, userId, synced])
  return null
}
