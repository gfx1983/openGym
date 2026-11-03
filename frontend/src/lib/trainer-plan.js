// A plan from the trainer: built in their own Plan with the ordinary editors, sent to the server
// as a plan file with a little around it, applied in the client's own app when the client says so.
// The server keeps it next to the state file and never writes into it (api/server.js), and the same
// parsePlan and mergePlan as a shared file do the checking and the unit conversion, so a trainer's
// plan can put nothing into a profile that a plan file could not.
//
// Re-applying is harmless by construction: a routine from this trainer carries `trainerSrc`, and
// the next version of it replaces that routine in place. Two devices that both apply, and a trainer
// who sends a correction, end with one routine whose id the week and the history still point at.
import { api } from './api.js'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'
import { deleteRoutine } from './routines.js'
import { scheduleModeOf } from './rotation.js'

const clone = v => JSON.parse(JSON.stringify(v))
const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** A running programme or a rotation owns the schedule: a week written now would be lost later. */
export const scheduleLocked = S => !!S?.programme || scheduleModeOf(S) === 'rotation'

/** The trainer's side: the routines picked from their own Plan, as the server takes them. */
export function buildTrainerPlan(S, { client, routineIds, week, removed = [], note = '' }) {
  const routines = (S.routines || []).filter(r => routineIds.includes(r.id))
  const bundle = buildPlanBundle({ ...S, routines, week: week || {}, programmes: {} }, '')
  const targets = {}
  for (const r of routines) if (r.clientCopy?.client === client && r.clientCopy.routine) targets[r.id] = r.clientCopy.routine
  return { id: client, bundle, targets, removed, schedule: !!week, note }
}

/** Into the trainer's own Plan, to edit with the ordinary screen. The copy it already has if any. */
export function copyClientRoutine(s, client, routine) {
  const had = (s.routines || []).find(r => r.clientCopy?.client === client.user.id && r.clientCopy.routine === routine.id)
  if (had) return had.id
  const bundle = buildPlanBundle({ unit: client.unit, routines: [routine], customEx: client.customEx || [], week: {} }, '')
  const { ids } = mergePlan(s, { ...parsePlan(bundle, s.unit ?? 'kg'), programmes: [] })
  const copy = s.routines.find(r => r.id === ids[0])
  copy.clientCopy = { client: client.user.id, routine: routine.id }
  return copy.id
}

/** What applying would do, for the card: which routines are new and which replace what. */
export function describeTrainerPlan(S, plan, trainerId) {
  const parsed = parsePlan(plan.bundle, S.unit ?? 'kg')
  const mine = S.routines || []
  return {
    routines: parsed.routines.map(r => ({ name: r.name, ex: r.ex, replaces: slotOf(mine, plan, trainerId, r.id)?.name || null })),
    removed: (plan.removed || []).map(id => mine.find(r => r.id === id)?.name).filter(Boolean),
    customEx: parsed.customEx,
    scheduleSkipped: !!plan.schedule && scheduleLocked(S),
    schedule: !!plan.schedule && !scheduleLocked(S),
  }
}

const srcKey = (trainerId, id) => trainerId + ':' + id
function slotOf(routines, plan, trainerId, srcId) {
  const target = plan.targets?.[srcId]
  return (target && routines.find(r => r.id === target)) || routines.find(r => r.trainerSrc === srcKey(trainerId, srcId)) || null
}

/**
 * Call inside store.update. Throws on what is not a plan, and update() then keeps nothing. The first
 * apply of a plan takes the snapshot Undo goes back to; an apply again leaves it, or Undo would go
 * back to the plan itself.
 */
export function applyTrainerPlan(s, plan, trainerId, trainerName) {
  const parsed = parsePlan(plan.bundle, s.unit ?? 'kg')
  s.routines = s.routines || []
  s.week = s.week || {}
  if (s.trainerUndo?.planId !== plan.id) {
    s.trainerUndo = { planId: plan.id, at: Date.now(), trainer: trainerName, routines: clone(s.routines), week: clone(s.week), dayPlan: clone(s.dayPlan || {}) }
  }
  // Added to a scratch profile, which maps the custom exercises and converts the units; what comes
  // out is then put in place here, where mergePlan would only ever add.
  const scratch = { unit: s.unit, customEx: s.customEx || [], exUnit: s.exUnit, routines: [], week: {} }
  const { ids } = mergePlan(scratch, { ...parsed, programmes: [] })
  s.customEx = scratch.customEx
  if (scratch.exUnit !== undefined) s.exUnit = scratch.exUnit
  const finalId = {}
  parsed.routines.forEach((r, i) => {
    const fresh = scratch.routines.find(x => x.id === ids[i])
    const key = srcKey(trainerId, r.id)
    const slot = slotOf(s.routines, plan, trainerId, r.id)
    if (slot) {
      const { prog, excludeFromProgression, ...kept } = slot
      s.routines[s.routines.indexOf(slot)] = { ...kept, ...fresh, id: slot.id, trainerSrc: key }
      finalId[r.id] = slot.id
    } else {
      s.routines.push({ ...fresh, trainerSrc: key })
      finalId[r.id] = fresh.id
    }
  })
  const sent = new Set(Object.values(finalId))
  for (const id of plan.removed || []) if (!sent.has(id)) deleteRoutine(s, id)
  if (!plan.schedule || scheduleLocked(s)) return { routines: parsed.routines.length, scheduleSkipped: !!plan.schedule }
  const known = new Set(s.routines.map(r => r.id))
  WEEK_DAYS.forEach(d => {
    const ids = [].concat(parsed.week?.[d] ?? []).map(id => finalId[id] || id).filter(id => known.has(id))
    if (ids.length) s.week[d] = ids
    else delete s.week[d]
  })
  return { routines: parsed.routines.length, scheduleSkipped: false }
}

/** Everything back as it was before the plan. Workouts are untouched: they are what happened. */
export function undoTrainerPlan(s) {
  const u = s.trainerUndo
  if (!u) return false
  s.routines = clone(u.routines)
  s.week = clone(u.week)
  s.dayPlan = { ...(s.dayPlan || {}), ...clone(u.dayPlan || {}) }
  delete s.trainerUndo
  return true
}

/** Undo, and let the trainer know. The profile is what matters: a server that missed it changes nothing here. */
export function undoAndTell(update, undo) {
  update(undoTrainerPlan)
  if (undo?.planId) api('/api/account/trainer/plan/resolve', { method: 'POST', body: JSON.stringify({ id: undo.planId, decision: 'undone' }) }).catch(() => {})
}
