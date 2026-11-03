import { create } from 'zustand'
import { useStore } from './useStore.js'
import { registerCustom } from '../lib/exercises.js'
import { loadClient } from '../lib/trainer-plan.js'

// A trainer working on a client's plan. The store's stand-in copy (enterTourSandbox) holds the
// client's plan while this runs: every screen shows and edits it, nothing is saved or synced, and
// leaving hands back the trainer's own copy untouched. `real` is that copy, for "from my plan".
// A reload ends it, as it ends the tour's practice workout.
export const useWorkspace = create(() => ({ client: null, base: null, real: null }))

export function enterWorkspace(client) {
  const st = useStore.getState()
  if (st.tourSandbox) return false
  const real = st.S
  st.enterTourSandbox(s => loadClient(s, client))
  const S = useStore.getState().S
  registerCustom(S.customEx)
  useWorkspace.setState({ client, base: JSON.parse(JSON.stringify(S)), real })
  return true
}

export function leaveWorkspace() {
  useWorkspace.setState({ client: null, base: null, real: null })
  if (useStore.getState().tourSandbox) useStore.getState().leaveTourSandbox()
}
