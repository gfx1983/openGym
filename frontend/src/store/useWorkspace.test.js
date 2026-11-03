// @vitest-environment happy-dom
// The whole point of the workspace: the trainer's own copy comes back untouched and nothing of the
// client's goes out under the trainer's account. Against the real store.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore } from './useStore.js'
import { enterWorkspace, leaveWorkspace, useWorkspace } from './useWorkspace.js'

const client = () => ({
  user: { id: 'c1', name: 'Ира' }, unit: 'kg', customEx: [], week: { 1: ['leg'] }, routines: [{ id: 'leg', name: 'Ноги', ex: [] }], dayPlan: {}, programmes: {},
  programme: null, exWeights: {}, exUnit: {}, bodyweight: [], measurements: [], workouts: [],
})

beforeEach(() => { leaveWorkspace() })

describe('the workspace', () => {
  it('edits on the copy, saves nothing, and hands the trainer\'s own plan back', async () => {
    const st = useStore.getState()
    st.update(s => { s.routines = [{ id: 'mine', name: 'Моя', ex: [] }] })
    const mine = JSON.stringify(useStore.getState().S.routines)
    const saved = localStorage.getItem('gym_state')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    expect(enterWorkspace(client())).toBe(true)
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['leg'])
    useStore.getState().update(s => { s.routines[0].name = 'Правка' })
    expect(useStore.getState().S.routines[0].name).toBe('Правка')
    expect(useWorkspace.getState().base.routines[0].name).toBe('Ноги')
    expect(useWorkspace.getState().real.routines[0].id).toBe('mine')
    expect(setItem.mock.calls.filter(([k, v]) => String(v).includes('Правка'))).toEqual([])
    setItem.mockRestore()

    leaveWorkspace()
    expect(JSON.stringify(useStore.getState().S.routines)).toBe(mine)
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useWorkspace.getState().client).toBe(null)
    expect(localStorage.getItem('gym_state')).toBe(saved)
  })
  it('does not start over the tour\'s practice workout', () => {
    useStore.getState().enterTourSandbox()
    expect(enterWorkspace(client())).toBe(false)
    useStore.getState().leaveTourSandbox()
  })
})
