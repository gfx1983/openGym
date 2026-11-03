// A trainer's plan in a client's profile: it replaces in place, says no to what the schedule's owner
// holds, comes back out with Undo, and survives the sync that follows.
import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { applyTrainerPlan, buildTrainerPlan, copyClientRoutine, describeTrainerPlan, scheduleLocked, undoTrainerPlan } from './trainer-plan.js'
import { mergeStates, stampEdits } from './sync-merge.js'

const clone = v => JSON.parse(JSON.stringify(v))
const [A, B] = Object.keys(EXIDX)
const T = 1_800_000_000_000
const client = extra => ({
  unit: 'kg', customEx: [], dayPlan: {}, workouts: [{ id: 'w1', routineId: 'mine', d: '2026-10-01' }],
  routines: [{ id: 'mine', name: 'Мой день', emoji: '🏋️', ex: [{ id: A, sets: 3, reps: 8 }] }, { id: 'other', name: 'Второй', ex: [{ id: B, sets: 2, reps: 5 }] }],
  week: { 1: ['mine'], 3: ['other'] }, ...extra
})
const trainer = extra => ({ unit: 'kg', customEx: [], routines: [{ id: 'tr', name: 'От тренера', emoji: '💪', ex: [{ id: B, sets: 4, reps: 6, weight: 100 }] }], week: {}, ...extra })
const planFor = (opts = {}, S = trainer()) => {
  const { id, ...body } = buildTrainerPlan(S, { client: 'c1', routineIds: S.routines.map(r => r.id), ...opts })
  return { id: 'p1', ...body }
}

describe('applying a plan', () => {
  it('adds a new routine, and a correction of it replaces it instead of adding a second', () => {
    const s = client()
    applyTrainerPlan(s, planFor(), 'T', 'Макс')
    expect(s.routines.map(r => r.name)).toEqual(['Мой день', 'Второй', 'От тренера'])
    const id = s.routines[2].id
    const fixed = trainer(); fixed.routines[0].ex[0].sets = 5
    applyTrainerPlan(s, { ...planFor({}, fixed), id: 'p2' }, 'T', 'Макс')
    expect(s.routines).toHaveLength(3)
    expect(s.routines[2].id).toBe(id)
    expect(s.routines[2].ex[0].sets).toBe(5)
  })

  it('the same plan on a second device changes nothing and keeps the Undo of the first', () => {
    const s = client()
    const before = clone(s.routines)
    applyTrainerPlan(s, planFor(), 'T', 'Макс')
    const once = clone(s.routines)
    applyTrainerPlan(s, planFor(), 'T', 'Макс')
    expect(s.routines).toEqual(once)
    expect(s.trainerUndo.routines).toEqual(before)
  })

  it('replacing a client routine keeps its id, so the week and the history still point at it', () => {
    const s = client()
    const S = trainer(); S.routines[0].clientCopy = { client: 'c1', routine: 'mine' }
    applyTrainerPlan(s, planFor({}, S), 'T', 'Макс')
    expect(s.routines).toHaveLength(2)
    expect(s.routines[0].id).toBe('mine')
    expect(s.routines[0].name).toBe('От тренера')
    expect(s.routines[0].clientCopy).toBeUndefined()
    expect(s.week[1]).toEqual(['mine'])
    expect(s.workouts[0].routineId).toBe('mine')
  })

  it('a copy made for another client replaces nothing here', () => {
    const s = client()
    const S = trainer(); S.routines[0].clientCopy = { client: 'someone else', routine: 'mine' }
    applyTrainerPlan(s, planFor({}, S), 'T', 'Макс')
    expect(s.routines).toHaveLength(3)
    expect(s.routines[0].name).toBe('Мой день')
  })

  it('a plan in kg reaches a client in lb converted', () => {
    const s = client({ unit: 'lb' })
    applyTrainerPlan(s, planFor(), 'T', 'Макс')
    const weight = s.routines[2].ex[0].weight
    expect(weight).toBeGreaterThan(200)
    expect(weight).toBeLessThan(230)
  })

  it('a running programme keeps its schedule, and the routines still arrive', () => {
    const s = client({ programme: { id: 'x', startedOn: '2026-11-02' } })
    const res = applyTrainerPlan(s, planFor({ week: { 5: ['tr'] } }), 'T', 'Макс')
    expect(res.scheduleSkipped).toBe(true)
    expect(s.week).toEqual({ 1: ['mine'], 3: ['other'] })
    expect(s.routines).toHaveLength(3)
    expect(scheduleLocked(s)).toBe(true)
  })

  it('the week replaces the whole week, mapped to the ids the routines ended up with', () => {
    const s = client()
    const res = applyTrainerPlan(s, planFor({ week: { 5: ['tr'], 2: ['other'], 6: ['gone'] } }), 'T', 'Макс')
    expect(res.scheduleSkipped).toBe(false)
    const added = s.routines[2].id
    expect(s.week).toEqual({ 5: [added], 2: ['other'] })
  })

  it('removes what it names, from the week too', () => {
    const s = client()
    applyTrainerPlan(s, planFor({ removed: ['other'], routineIds: [] }), 'T', 'Макс')
    expect(s.routines.map(r => r.id)).toEqual(['mine'])
    expect(s.week).toEqual({ 1: ['mine'] })
  })

  it('leaves out an exercise nobody knows, and brings a custom one along once', () => {
    const custom = { id: 'cx', n: 'Своё', bp: 'chest', custom: true }
    const S = trainer({ customEx: [custom] })
    S.routines[0].ex = [{ id: 'cx', sets: 1, reps: 1 }, { id: 'no such exercise', sets: 1, reps: 1 }]
    const s = client()
    applyTrainerPlan(s, planFor({}, S), 'T', 'Макс')
    applyTrainerPlan(s, { ...planFor({}, S), id: 'p2' }, 'T', 'Макс')
    expect(s.customEx).toHaveLength(1)
    expect(s.routines[2].ex.map(e => e.id)).toEqual([s.customEx[0].id])
  })

  it('throws on what is not a plan, before touching anything', () => {
    const s = client()
    const before = clone(s)
    expect(() => applyTrainerPlan(s, { id: 'x', bundle: { routines: 'nope' } }, 'T', 'Макс')).toThrow()
    expect(s).toEqual(before)
  })

  it('Undo puts the routines and the week back, workouts aside, and is then gone', () => {
    const s = client()
    const { routines, week, workouts } = clone(s)
    applyTrainerPlan(s, planFor({ week: { 5: ['tr'] }, removed: ['other'] }), 'T', 'Макс')
    expect(undoTrainerPlan(s)).toBe(true)
    expect(s.routines).toEqual(routines)
    expect(s.week).toEqual(week)
    expect(s.workouts).toEqual(workouts)
    expect(s.trainerUndo).toBeUndefined()
    expect(undoTrainerPlan(s)).toBe(false)
  })
})

describe('what the card says', () => {
  it('names what is replaced, what is new and what goes', () => {
    const S = trainer({ routines: [
      { id: 'a', name: 'Новая', ex: [{ id: A, sets: 1, reps: 1 }] },
      { id: 'b', name: 'Правка', clientCopy: { client: 'c1', routine: 'mine' }, ex: [{ id: A, sets: 1, reps: 1 }] },
    ] })
    const about = describeTrainerPlan(client(), planFor({ removed: ['other'], week: { 1: ['a'] } }, S), 'T')
    expect(about.routines.map(r => r.replaces)).toEqual([null, 'Мой день'])
    expect(about.removed).toEqual(['Второй'])
    expect(about.schedule).toBe(true)
  })
})

describe('the trainer\'s copy', () => {
  const d = { user: { id: 'c1' }, unit: 'lb', customEx: [], routines: [] }
  const r = { id: 'mine', name: 'Его день', emoji: '🏋️', ex: [{ id: A, sets: 3, reps: 8, weight: 220 }] }
  it('lands in their own units, marked as the client\'s, and opening it again adds no second copy', () => {
    const s = trainer({ routines: [] })
    const id = copyClientRoutine(s, d, r)
    expect(s.routines[0].clientCopy).toEqual({ client: 'c1', routine: 'mine' })
    expect(s.routines[0].ex[0].weight).toBeLessThan(110)
    expect(copyClientRoutine(s, d, r)).toBe(id)
    expect(s.routines).toHaveLength(1)
  })
  it('is sent back as a replacement of that routine, without the mark', () => {
    const s = trainer({ routines: [] })
    copyClientRoutine(s, d, r)
    const body = buildTrainerPlan(s, { client: 'c1', routineIds: [s.routines[0].id] })
    expect(body.targets).toEqual({ [s.routines[0].id]: 'mine' })
    expect(JSON.stringify(body.bundle)).not.toContain('clientCopy')
    expect(body.schedule).toBe(false)
    expect(body.bundle.programmes ?? []).toEqual([])
  })
})

describe('through the sync', () => {
  const edit = (prev, at, mut) => { const n = clone(prev); mut(n); n._ts = at; return stampEdits(prev, n, at) }
  const start = () => stampEdits(null, { ...client(), _ts: T }, T)

  it('an applied plan wins over a device that has not heard of it, in either order', () => {
    const s0 = start()
    const phone = edit(s0, T + 10, s => { applyTrainerPlan(s, planFor(), 'T', 'Макс') })
    const desk = edit(s0, T + 5, s => { s.bodyweight = [{ d: '2026-11-01', w: 80 }] })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.routines.map(r => r.name)).toContain('От тренера')
      expect(m.trainerUndo.planId).toBe('p1')
    }
  })

  it('Undo brings a removed routine back through the merge with the device that saw it removed', () => {
    const s0 = start()
    const applied = edit(s0, T + 10, s => { applyTrainerPlan(s, planFor({ removed: ['other'], routineIds: [] }), 'T', 'Макс') })
    expect(applied.routines.map(r => r.id)).toEqual(['mine'])
    const undone = edit(applied, T + 20, s => { undoTrainerPlan(s) })
    for (const m of [mergeStates(undone, applied), mergeStates(applied, undone)]) {
      expect(m.routines.map(r => r.id).sort()).toEqual(['mine', 'other'])
      expect(m.trainerUndo).toBeUndefined()
    }
  })
})
