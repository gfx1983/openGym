// A trainer's changes in a client's profile: what they did not touch stays as the client has it,
// programmes travel and start, the schedule's owner is respected, Undo takes it all back, and the
// sync that follows holds it.
import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { addFromMyPlan, applyTrainerPlan, buildTrainerPlan, diffWorkspace, isEmptyDiff, loadClient, scheduleLocked, setClientModules, undoTrainerPlan, wantsClientModules } from './trainer-plan.js'
import { mergeStates, stampEdits } from './sync-merge.js'
import { presetOf } from './modules.js'

const clone = v => JSON.parse(JSON.stringify(v))
const [A, B, C] = Object.keys(EXIDX)
const T = 1_800_000_000_000
const client = extra => ({
  unit: 'kg', customEx: [], dayPlan: {}, programmes: {}, programme: null, rotation: null, queue: null, scheduleMode: null,
  workouts: [{ id: 'w1', routineId: 'leg', d: '2026-10-01' }],
  routines: [{ id: 'leg', name: 'Ноги', emoji: '🦵', ex: [{ id: A, sets: 3, reps: 8, weight: 60 }] }, { id: 'back', name: 'Спина', ex: [{ id: B, sets: 2, reps: 5, weight: 40 }] }],
  week: { 1: ['leg'], 3: ['back'] }, ...extra
})
// Works on a copy the way the trainer's screens do, and returns what would be sent.
const edit = (base, mut, note) => {
  const draft = clone(base)
  mut(draft)
  const { id, ...plan } = buildTrainerPlan(base, draft, 'c1', note)
  return { id: 'p1', ...clone(plan) }
}
const leg = s => s.routines.find(r => r.id === 'leg')

describe('what counts as a change', () => {
  it('nothing changed is nothing to send, whatever the sync stamped', () => {
    const base = client()
    const draft = clone(base)
    draft.routines[0]._ts = 123
    expect(isEmptyDiff(diffWorkspace(base, draft))).toBe(true)
  })
  it('sends only what changed', () => {
    const plan = edit(client(), s => { s.routines[0].ex[0].sets = 5 })
    expect(plan.bundle.routines.map(r => r.id)).toEqual(['leg'])
    expect(plan.schedule).toBe(false)
    expect(plan.summary).toEqual(['Изменена программа: Ноги'])
  })
})

describe('applying', () => {
  it('needs nobody to confirm: it changes the routine and keeps its id, week and history', () => {
    const s = client()
    applyTrainerPlan(s, edit(client(), d => { d.routines[0].name = 'Ноги v2' }), 'Макс')
    expect(s.routines).toHaveLength(2)
    expect(leg(s).name).toBe('Ноги v2')
    expect(s.week[1]).toEqual(['leg'])
    expect(s.workouts[0].routineId).toBe('leg')
    expect(s.trainerUndo.seen).toBe(false)
    expect(s.trainerUndo.trainer).toBe('Макс')
  })

  it('a new routine keeps the id it got, so applying twice from two devices adds one', () => {
    const plan = edit(client(), d => { d.routines.push({ id: 'new', name: 'Новая', ex: [{ id: B, sets: 1, reps: 1 }] }) })
    const s = client()
    applyTrainerPlan(s, plan, 'Макс')
    const once = clone(s.routines)
    const before = clone(s.trainerUndo.snapshot.routines)
    applyTrainerPlan(s, plan, 'Макс')
    expect(s.routines).toEqual(once)
    expect(s.routines).toHaveLength(3)
    expect(s.trainerUndo.snapshot.routines).toEqual(before)
  })

  it('a weight the client moved while the trainer edited holds', () => {
    const plan = edit(client(), d => { d.routines[0].ex[0].sets = 5 })
    const s = client()
    leg(s).ex[0].weight = 70
    applyTrainerPlan(s, plan, 'Макс')
    expect(leg(s).ex[0]).toMatchObject({ sets: 5, weight: 70 })
  })

  it('a weight the trainer changed wins over the client\'s', () => {
    const plan = edit(client(), d => { d.routines[0].ex[0].weight = 80 })
    const s = client()
    leg(s).ex[0].weight = 70
    applyTrainerPlan(s, plan, 'Макс')
    expect(leg(s).ex[0].weight).toBe(80)
  })

  it('an exercise the client added meanwhile stays, one the trainer took out goes', () => {
    const base = client()
    base.routines[0].ex.push({ id: B, sets: 2, reps: 2 })
    const plan = edit(base, d => { d.routines[0].ex = d.routines[0].ex.filter(e => e.id !== B) })
    const s = clone(base)
    leg(s).ex.push({ id: C, sets: 1, reps: 1 })
    applyTrainerPlan(s, plan, 'Макс')
    expect(leg(s).ex.map(e => e.id)).toEqual([A, C])
  })

  it('a plan in kg reaches a client who moved to lb converted, and the kept weight stays theirs', () => {
    const plan = edit(client(), d => { d.routines[0].ex[0].weight = 100 })
    const s = client({ unit: 'lb' })
    applyTrainerPlan(s, plan, 'Макс')
    expect(leg(s).ex[0].weight).toBeGreaterThan(200)
    expect(leg(s).ex[0].weight).toBeLessThan(230)
  })

  it('the week replaces the whole week; a rest day stays a rest day', () => {
    const plan = edit(client(), d => { d.week = { 5: ['back'] } })
    expect(plan.schedule).toBe(true)
    const s = client()
    applyTrainerPlan(s, plan, 'Макс')
    expect(s.week).toEqual({ 5: ['back'] })
  })

  it('removes what it names, from the week too', () => {
    const plan = edit(client(), d => { d.routines = d.routines.filter(r => r.id !== 'back'); delete d.week[3] })
    const s = client()
    applyTrainerPlan(s, plan, 'Макс')
    expect(s.routines.map(r => r.id)).toEqual(['leg'])
    expect(s.week).toEqual({ 1: ['leg'] })
  })

  it('leaves out an exercise nobody knows', () => {
    const plan = edit(client(), d => { d.routines[0].ex.push({ id: 'no such exercise', sets: 1, reps: 1 }) })
    const s = client()
    applyTrainerPlan(s, plan, 'Макс')
    expect(leg(s).ex.map(e => e.id)).toEqual([A])
  })

  it('throws on what is not a plan, before touching anything', () => {
    const s = client()
    const before = clone(s)
    expect(() => applyTrainerPlan(s, { id: 'x', bundle: { routines: 'nope' } }, 'Макс')).toThrow()
    expect(s).toEqual(before)
  })
})

describe('programmes', () => {
  const P = { id: 'cyc', name: 'Силовой блок', at: 1, weeks: [{ rpe: 7 }, { rpe: 8 }, { deload: true }], days: { 2: ['leg'], 5: ['back'] } }

  it('a new one arrives with its weeks, under its own id, over the client\'s routines', () => {
    const plan = edit(client(), d => { d.programmes = { cyc: clone(P) } })
    expect(plan.bundle.routines.map(r => r.id).sort()).toEqual(['back', 'leg'])
    const s = client()
    leg(s).ex[0].weight = 70
    applyTrainerPlan(s, plan, 'Макс')
    expect(s.programmes.cyc.weeks).toHaveLength(3)
    expect(s.programmes.cyc.days).toEqual(P.days)
    expect(s.programme).toBe(null)
    expect(s.routines).toHaveLength(2)
    expect(leg(s).ex[0].weight).toBe(70)
  })

  it('started by the trainer, it starts for the client: their week goes into `saved` and comes back with Undo', () => {
    const base = client()
    const plan = edit(base, d => {
      d.programmes = { cyc: clone(P) }
      d.programme = { id: 'cyc', startedOn: '2026-11-02', cycle: 1, bump: 0 }
      d.week = clone(P.days)
    })
    expect(plan.run).toEqual({ start: 'cyc' })
    expect(plan.schedule).toBe(false)
    const s = client()
    applyTrainerPlan(s, plan, 'Макс', '2026-11-03')
    expect(s.programme).toMatchObject({ id: 'cyc', startedOn: '2026-11-03' })
    expect(s.week).toEqual(P.days)
    expect(s.programme.saved.week).toEqual({ 1: ['leg'], 3: ['back'] })
    undoTrainerPlan(s)
    expect(s.programme).toBe(null)
    expect(s.week).toEqual({ 1: ['leg'], 3: ['back'] })
    expect(s.programmes).toEqual({})
  })

  it('a client\'s running programme keeps its schedule against a week sent without knowing', () => {
    const plan = edit(client(), d => { d.week = { 5: ['back'] } })
    const s = client({ programmes: { mine: clone(P) }, programme: { id: 'mine', startedOn: '2026-11-02' } })
    applyTrainerPlan(s, plan, 'Макс')
    expect(s.week).toEqual({ 1: ['leg'], 3: ['back'] })
    expect(s.trainerUndo.scheduleSkipped).toBe(true)
    expect(scheduleLocked(s)).toBe(true)
  })

  it('ending the client\'s programme and deleting one both travel', () => {
    const base = client({ programmes: { cyc: clone(P) }, programme: { id: 'cyc', startedOn: '2026-11-02', saved: { week: { 6: ['leg'] }, rotation: null, scheduleMode: null } } })
    const plan = edit(base, d => { d.programme = null; d.programmes = {} })
    expect(plan.run).toEqual({ end: true })
    expect(plan.removedProgrammes).toEqual(['cyc'])
    const s = clone(base)
    applyTrainerPlan(s, plan, 'Макс')
    expect(s.programme).toBe(null)
    expect(s.programmes.cyc).toBeUndefined()
    expect(s.week).toEqual({ 6: ['leg'] })
  })
})

describe('the trainer\'s workspace', () => {
  const d = {
    user: { id: 'c1' }, unit: 'lb', customEx: [], week: { 1: ['leg'] }, routines: client().routines, dayPlan: {}, programmes: {}, programme: null,
    exWeights: {}, exUnit: {}, bodyweight: [], measurements: [], workouts: [{ id: 'new', d: '2026-11-02' }, { id: 'old', d: '2026-10-01' }],
  }
  it('shows the client\'s plan in the client\'s units, workouts oldest first, and none of the trainer\'s plan', () => {
    const s = { unit: 'kg', routines: [{ id: 'mine', name: 'Моя' }], week: { 2: ['mine'] }, workouts: [], active: { id: 'a' }, trainerUndo: {} }
    loadClient(s, d)
    expect(s.routines.map(r => r.id)).toEqual(['leg', 'back'])
    expect(s.unit).toBe('lb')
    expect(s.workouts.map(w => w.id)).toEqual(['old', 'new'])
    expect(s.active).toBe(null)
    expect(s.trainerUndo).toBeUndefined()
  })
  it('takes from the trainer\'s own plan a copy, in the client\'s units, leaving theirs alone', () => {
    const real = { unit: 'kg', customEx: [], routines: [{ id: 'mine', name: 'Моя', ex: [{ id: A, sets: 3, reps: 5, weight: 100 }] }], programmes: { p: { id: 'p', name: 'Блок', at: 1, weeks: [{}, {}], days: { 1: ['mine'] } } } }
    const frozen = clone(real)
    const s = { unit: 'lb', routines: [], week: {}, customEx: [], programmes: {} }
    addFromMyPlan(s, real, { programmeId: 'p' })
    expect(real).toEqual(frozen)
    expect(s.routines).toHaveLength(1)
    expect(s.routines[0].id).not.toBe('mine')
    expect(s.routines[0].ex[0].weight).toBeGreaterThan(200)
    const [p] = Object.values(s.programmes)
    expect(p.weeks).toHaveLength(2)
    expect(p.days[1]).toEqual([s.routines[0].id])
  })
})

describe('through the sync', () => {
  const change = (prev, at, mut) => { const n = clone(prev); mut(n); n._ts = at; return stampEdits(prev, n, at) }
  const start = () => stampEdits(null, { ...client(), _ts: T }, T)

  it('applied changes win over a device that has not heard of them, in either order', () => {
    const s0 = start()
    const plan = edit(client(), d => { d.routines[0].name = 'Ноги v2' })
    const phone = change(s0, T + 10, s => { applyTrainerPlan(s, plan, 'Макс') })
    const desk = change(s0, T + 5, s => { s.bodyweight = [{ d: '2026-11-01', w: 80 }] })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(leg(m).name).toBe('Ноги v2')
      expect(m.trainerUndo.planId).toBe('p1')
    }
  })

  it('Undo brings a removed routine back through the merge with the device that saw it removed', () => {
    const s0 = start()
    const plan = edit(client(), d => { d.routines = d.routines.filter(r => r.id !== 'back'); delete d.week[3] })
    const applied = change(s0, T + 10, s => { applyTrainerPlan(s, plan, 'Макс') })
    expect(applied.routines.map(r => r.id)).toEqual(['leg'])
    const undone = change(applied, T + 20, s => { undoTrainerPlan(s) })
    for (const m of [mergeStates(undone, applied), mergeStates(applied, undone)]) {
      expect(m.routines.map(r => r.id).sort()).toEqual(['back', 'leg'])
      expect(m.trainerUndo).toBeUndefined()
    }
  })
})

describe('a new client\'s modules', () => {
  it('sets training and body on a profile that has chosen nothing and logged nothing', () => {
    const s = { workouts: [] }
    expect(wantsClientModules(s)).toBe(true)
    setClientModules(s)
    expect(presetOf(s)).toBe('body')
    expect(s.modules.coach).toBe(false)
    expect(wantsClientModules(s)).toBe(false)
  })

  it('leaves alone a profile with a choice, a history or a session under way', () => {
    for (const s of [{ workouts: [], modules: { body: false } }, { workouts: [{ id: 'w' }] }, { workouts: [], active: { id: 'a' } }]) {
      const before = JSON.stringify(s)
      setClientModules(s)
      expect(JSON.stringify(s)).toBe(before)
    }
  })
})
