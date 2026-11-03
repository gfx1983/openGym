import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { applyWaitingPlan } from '../lib/trainer-plan.js'

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
  return null
}
