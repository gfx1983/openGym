// The numbers the client's next session opens with after a trainer's change, read through the same
// build the session start uses: a weight in the plan that never reaches the bar helps nobody.
import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { buildSessionEntry, plannedConfigOf } from './session-start.js'
import { applyTrainerPlan, buildTrainerPlan } from './trainer-plan.js'

const clone = v => JSON.parse(JSON.stringify(v))
const [A] = Object.keys(EXIDX).filter(id => !EXIDX[id].bw && !EXIDX[id].bodyweight)
const profile = (prog, extra) => {
  const routine = { id: 'leg', name: 'Ноги', ...(prog ? { prog } : {}), ex: [{ id: A, sets: 3, reps: 8, weight: 60, mode: 'reps' }] }
  const S = { unit: 'kg', customEx: [], routines: [routine], week: {}, workouts: [], programmes: {}, ...extra }
  // A real logged session of it, built the way the session start builds one.
  const entry = buildSessionEntry(S, A, routine.ex[0], routine)
  // Lifted above the routine's 60, so the opening number tells which of the two it came from.
  entry.sets = entry.sets.map(s => ({ ...s, w: 70, r: 8, done: true }))
  S.workouts = [{ id: 'w1', d: '2026-11-01', name: 'Ноги', routineId: 'leg', start: 1, end: 2, entries: [{ ...entry, id: A, rid: 'leg', planned: plannedConfigOf(entry) }] }]
  return S
}
const send = (S, mut) => {
  const draft = clone(S)
  mut(draft)
  const { id, ...plan } = buildTrainerPlan(S, draft, 'c1')
  return { id: 'p1', ...clone(plan) }
}
const opening = S => buildSessionEntry(S, A, S.routines[0].ex[0], S.routines[0]).sets.filter(s => !s.warmup)[0].w

describe('the next session after a trainer changes the weight', () => {
  for (const [label, prog, extra] of [
    ['no policy named', undefined, {}], ['linear', 'linear', {}], ['double', 'double', {}], ['off', 'off', {}],
    ['off, starting from the last session', 'off', { startFrom: 'last' }],
  ]) {
    it(label + ': opens at the trainer\'s weight, then the history takes over from it', () => {
      const S = profile(prog, extra)
      expect(opening(S)).toBeLessThan(80)
      applyTrainerPlan(S, send(S, d => { d.routines[0].ex[0].weight = 80 }), 'Макс')
      expect(opening(S)).toBe(80)
      // The session after it, logged: from here on it is an ordinary exercise again.
      const entry = buildSessionEntry(S, A, S.routines[0].ex[0], S.routines[0])
      entry.sets = entry.sets.map(s => ({ ...s, w: 90, r: 8, done: true }))
      S.workouts.push({ id: 'w2', d: '2026-11-04', name: 'Ноги', routineId: 'leg', start: Date.now() + 1000, end: Date.now() + 2000, entries: [{ ...entry, id: A, rid: 'leg', planned: plannedConfigOf(entry) }] })
      if (prog !== 'off' || extra.startFrom) expect(opening(S)).not.toBe(80)
    })
  }

  it('a change of sets alone leaves the weight to the client\'s own history', () => {
    const S = profile('linear')
    applyTrainerPlan(S, send(S, d => { d.routines[0].ex[0].sets = 5 }), 'Макс')
    expect(S.routines[0].ex[0].weightSetAt).toBeUndefined()
    expect(opening(S)).toBeLessThan(80)
    expect(opening(S)).toBeGreaterThanOrEqual(70)
  })

  it('a running programme\'s target still wins, as it does over everything', () => {
    const S = profile('linear', {
      programmes: { p: { id: 'p', name: 'Блок', at: 1, weeks: [{ deload: true }], days: { 1: ['leg'] } } },
      programme: { id: 'p', startedOn: '2026-11-02', cycle: 1, bump: 0 },
    })
    applyTrainerPlan(S, send(S, d => { d.routines[0].ex[0].weight = 80 }), 'Макс')
    expect(S.routines[0].ex[0].weightSetAt).toBeGreaterThan(0)
    expect(opening(S)).toBeLessThanOrEqual(80)
  })
})
