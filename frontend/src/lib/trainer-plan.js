// A trainer's changes to a client's plan. The trainer works on a copy of the client's plan with the
// ordinary screens (store/useWorkspace.js), so their own Plan never holds a client's routines. What
// they changed goes to the server as a plan file with a little around it, and the client's own app
// applies it the next time it opens, unasked: the server never writes the client's state file, a
// sync could wipe what it did. The same parsePlan and mergePlan as a shared file do the checking and
// the unit conversion, so a trainer can put nothing into a profile that a plan file could not.
//
// Applying is a three-way merge against what the trainer started from: what the trainer did not
// touch stays as the client has it now. A weight the client moved while the trainer was editing
// holds, unless the trainer changed that same weight, and then `weightSetAt` makes the next session
// open at it (lib/session-start.js). Ids are kept, so the week and the history still point at the
// routine, and applying twice from two devices ends in the same place.
import { api } from './api.js'
import { todayISO } from './format.js'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'
import { deleteProgramme, endProgramme, importedProgramme, programmeRoutineIds, startProgramme, programmeById } from './programmes.js'
import { deleteRoutine } from './routines.js'
import { scheduleModeOf } from './rotation.js'

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6]
const UNDO_KEYS = ['routines', 'week', 'dayPlan', 'programmes', 'programme', 'rotation', 'queue', 'scheduleMode']
const bare = r => { const { _ts, ...rest } = r; return rest }
const weekOf = S => Object.fromEntries(WEEK_DAYS.filter(d => [].concat(S?.week?.[d] ?? []).length).map(d => [d, [].concat(S.week[d])]))

/** A running programme or a rotation owns the schedule: a week written now would be lost later. */
export const scheduleLocked = S => !!S?.programme || scheduleModeOf(S) === 'rotation'

/** Into the store's stand-in copy: the client's plan and what the screens need around it. */
export function loadClient(s, d) {
  Object.assign(s, {
    unit: d.unit, routines: clone(d.routines), week: clone(d.week), customEx: clone(d.customEx), dayPlan: clone(d.dayPlan) || {},
    programmes: clone(d.programmes) || {}, programme: clone(d.programme) ?? null, rotation: clone(d.rotation) ?? null,
    queue: clone(d.queue) ?? null, scheduleMode: d.scheduleMode ?? null, exWeights: clone(d.exWeights) || {}, exUnit: clone(d.exUnit) || {},
    // The server sends the newest first, the app keeps them oldest first.
    workouts: clone(d.workouts).reverse(), bodyweight: clone(d.bodyweight), measurements: clone(d.measurements), active: null,
    // The Assistant answers under the trainer's account: it has no business with a client's data.
    modules: { ...(isMap(s.modules) ? s.modules : {}), coach: false },
  })
  delete s.trainerUndo
}

/** What the trainer changed, from the copy they started with to the one they are looking at. */
export function diffWorkspace(base, draft) {
  const baseR = new Map((base.routines || []).map(r => [r.id, r]))
  const routines = (draft.routines || []).filter(r => !baseR.has(r.id) || !same(bare(baseR.get(r.id)), bare(r))).map(r => r.id)
  const ids = new Set((draft.routines || []).map(r => r.id))
  const removed = (base.routines || []).filter(r => !ids.has(r.id)).map(r => r.id)
  const baseP = isMap(base.programmes) ? base.programmes : {}, draftP = isMap(draft.programmes) ? draft.programmes : {}
  const programmes = Object.keys(draftP).filter(id => !same(baseP[id], draftP[id]))
  const removedProgrammes = Object.keys(baseP).filter(id => !(id in draftP))
  const was = base.programme, now = draft.programme
  const run = now?.id && (now.id !== was?.id || now.startedOn !== was?.startedOn) ? { start: now.id } : was && !now ? { end: true } : null
  // A programme writes its own schedule, a rotation is not a week: only a plain week travels.
  const week = !run && !scheduleLocked(draft) && !same(weekOf(base), weekOf(draft)) ? weekOf(draft) : null
  return { routines, removed, programmes, removedProgrammes, run, week, rotationChanged: !same(base.rotation, draft.rotation) && !now }
}

export const isEmptyDiff = d => !d.routines.length && !d.removed.length && !d.programmes.length && !d.removedProgrammes.length && !d.run && !d.week

/** The lines the trainer's status and the client's notice both show. */
export function summarize(base, draft, diff) {
  const nameOf = id => (draft.routines || []).find(r => r.id === id)?.name || 'Без названия'
  const baseIds = new Set((base.routines || []).map(r => r.id))
  const progName = (S, id) => S.programmes?.[id]?.name || 'Без названия'
  return [
    ...diff.routines.map(id => (baseIds.has(id) ? 'Изменена программа: ' : 'Новая программа: ') + nameOf(id)),
    ...diff.removed.map(id => 'Убрана программа: ' + ((base.routines || []).find(r => r.id === id)?.name || 'Без названия')),
    ...diff.programmes.map(id => (base.programmes?.[id] ? 'Изменён цикл: ' : 'Новый цикл: ') + progName(draft, id)),
    ...diff.removedProgrammes.map(id => 'Убран цикл: ' + progName(base, id)),
    ...(diff.run?.start ? ['Запущен цикл: ' + progName(draft, diff.run.start)] : []),
    ...(diff.run?.end ? ['Цикл завершён'] : []),
    ...(diff.week ? ['Новое расписание на неделю'] : []),
  ]
}

/** The request body. A programme brings the routines it schedules, changed or not: they are its ids. */
export function buildTrainerPlan(base, draft, clientId, note = '') {
  const diff = diffWorkspace(base, draft)
  const programmes = Object.fromEntries(diff.programmes.map(id => [id, draft.programmes[id]]))
  const wanted = new Set(diff.routines)
  for (const p of Object.values(programmes)) for (const id of programmeRoutineIds(draft, p)) wanted.add(id)
  const routines = (draft.routines || []).filter(r => wanted.has(r.id))
  const bundle = buildPlanBundle({ ...draft, routines, week: diff.week || {}, programmes }, '')
  const start = (base.routines || []).filter(r => wanted.has(r.id))
  return {
    id: clientId, bundle, base: buildPlanBundle({ ...base, routines: start, week: {}, programmes: {} }, ''),
    removed: diff.removed, removedProgrammes: diff.removedProgrammes, run: diff.run, schedule: !!diff.week,
    summary: summarize(base, draft, diff), note,
  }
}

/** A routine or a programme from the trainer's own Plan, as a new one in the client's copy. */
export function addFromMyPlan(s, real, { routineId, programmeId }) {
  const p = programmeId ? programmeById(real, programmeId) : null
  const ids = new Set(p ? programmeRoutineIds(real, p) : [routineId])
  const routines = (real.routines || []).filter(r => ids.has(r.id))
  const bundle = buildPlanBundle({ ...real, routines, week: {}, programmes: p ? { [p.id]: p } : {} }, '')
  mergePlan(s, parsePlan(bundle, s.unit ?? 'kg'))
}

function mergeFields(base, fresh, current) {
  const out = { ...current }
  for (const k of new Set([...Object.keys(fresh), ...Object.keys(base || {})])) {
    if (same(fresh[k], base?.[k])) continue
    if (fresh[k] === undefined) delete out[k]
    else out[k] = fresh[k]
  }
  return out
}

// The nth of an exercise in a routine: the same one can be in there twice.
const keyed = list => {
  const seen = {}, out = new Map()
  for (const e of list || []) { seen[e.id] = (seen[e.id] || 0) + 1; out.set(e.id + '#' + seen[e.id], e) }
  return out
}

function mergeRoutine(base, fresh, current) {
  const { ex: bex, ...b } = base || {}, { ex: fex, ...f } = fresh, { ex: cex, ...c } = current
  const bk = keyed(bex), fk = keyed(fex), ck = keyed(cex)
  const ex = []
  for (const [k, e] of fk) {
    const was = bk.get(k), now = ck.get(k)
    const set = e.weight > 0 && !same(e.weight, was?.weight) ? { weightSetAt: Date.now() } : {}
    if (now) ex.push({ ...mergeFields(was, e, now), ...set })
    // Gone from the client's since, and the trainer did not touch it: gone it stays.
    else if (!was || !same(was, e)) ex.push({ ...e, ...set })
  }
  // Added by the client since: the trainer never saw it to take it out.
  for (const [k, e] of ck) if (!bk.has(k) && !fk.has(k)) ex.push(e)
  return { ...mergeFields(base ? b : c, f, c), ex }
}

/**
 * Call inside store.update. Throws on what is not a plan, and update() then keeps nothing. The first
 * apply of a plan takes the snapshot Undo goes back to; an apply again leaves it, or Undo would go
 * back to the plan itself.
 */
export function applyTrainerPlan(s, plan, trainerName, today = todayISO()) {
  const unit = s.unit ?? 'kg'
  const parsed = parsePlan(plan.bundle, unit)
  const start = plan.base ? parsePlan(plan.base, unit) : null
  s.routines = s.routines || []
  s.week = s.week || {}
  if (s.trainerUndo?.planId !== plan.id) {
    s.trainerUndo = {
      planId: plan.id, at: Date.now(), trainer: trainerName, note: plan.note || '', summary: plan.summary || [], seen: false,
      snapshot: Object.fromEntries(UNDO_KEYS.filter(k => s[k] !== undefined).map(k => [k, clone(s[k])])),
    }
  }
  // Added to a scratch profile, which maps the custom exercises and converts the units; what comes
  // out is put in place here, where mergePlan would only ever add.
  const scratch = { unit: s.unit, customEx: s.customEx || [], exUnit: s.exUnit, routines: [], week: {} }
  const { ids, exIdMap } = mergePlan(scratch, { ...parsed, programmes: [] })
  s.customEx = scratch.customEx
  if (scratch.exUnit !== undefined) s.exUnit = scratch.exUnit
  const sent = {}
  parsed.routines.forEach((r, i) => {
    const fresh = scratch.routines.find(x => x.id === ids[i])
    const id = typeof r.id === 'string' && r.id ? r.id : fresh.id
    sent[r.id] = id
    const at = s.routines.findIndex(x => x.id === id)
    if (at < 0) s.routines.push({ ...fresh, id })
    else s.routines[at] = { ...mergeRoutine(start?.routines.find(x => x.id === id), { ...fresh, id }, s.routines[at]), id }
  })
  for (const p of parsed.programmes || []) {
    const got = importedProgramme(p, sent, exIdMap)
    if (got && typeof p.id === 'string' && p.id) s.programmes = { ...(isMap(s.programmes) ? s.programmes : {}), [p.id]: { ...got, id: p.id } }
  }
  for (const id of plan.removedProgrammes || []) deleteProgramme(s, id, today)
  for (const id of plan.removed || []) if (!Object.values(sent).includes(id)) deleteRoutine(s, id)
  if (plan.run?.start) startProgramme(s, plan.run.start, today)
  else if (plan.run?.end) endProgramme(s, today)
  if (!plan.schedule) return { scheduleSkipped: false }
  if (scheduleLocked(s)) { s.trainerUndo.scheduleSkipped = true; return { scheduleSkipped: true } }
  const known = new Set(s.routines.map(r => r.id))
  WEEK_DAYS.forEach(d => {
    const list = [].concat(parsed.week?.[d] ?? []).filter(id => known.has(id))
    if (list.length) s.week[d] = list
    else delete s.week[d]
  })
  return { scheduleSkipped: false }
}

/** Everything back as it was before the plan. Workouts are untouched: they are what happened. */
export function undoTrainerPlan(s) {
  const u = s.trainerUndo
  if (!u) return false
  for (const k of UNDO_KEYS) {
    if (k in u.snapshot) s[k] = clone(u.snapshot[k])
    else delete s[k]
  }
  delete s.trainerUndo
  return true
}

/** Undo, and let the trainer know. The profile is what matters: a server that missed it changes nothing here. */
export function undoAndTell(update, undo) {
  update(undoTrainerPlan)
  if (undo?.planId) api('/api/account/trainer/plan/resolve', { method: 'POST', body: JSON.stringify({ id: undo.planId, decision: 'undone' }) }).catch(() => {})
}

/** The client's side: whatever is waiting goes in. True when something did. */
export async function applyWaitingPlan(useStore) {
  const got = await api('/api/account/trainer')
  if (!got.trainer) return { trainer: false }
  if (!got.plan) return { trainer: true }
  useStore.getState().update(s => { applyTrainerPlan(s, got.plan, got.trainer.name) })
  // Withdrawn or settled on another device meanwhile: there is nothing left to tell the server.
  await api('/api/account/trainer/plan/resolve', { method: 'POST', body: JSON.stringify({ id: got.plan.id, decision: 'applied' }) })
    .catch(e => { if (e.code !== 'stale') throw e })
  return { trainer: true, applied: true }
}
