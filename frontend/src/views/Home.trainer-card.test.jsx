// @vitest-environment happy-dom
// A profile with no plan: a trainer's client hears who is preparing one, anyone else gets the
// starter plan, and neither sees the other's card while the answer is on its way.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { presetModules } from '../lib/modules.js'
import Home from './Home.jsx'

const mocks = vi.hoisted(() => ({ answer: null }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: () => mocks.answer() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const draw = async ({ user = { id: 'u1', name: 'Богдан' }, routines = [] } = {}) => {
  useStore.setState(s => ({
    user,
    S: { ...s.S, routines, workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, modules: presetModules('body') },
  }))
  await act(async () => { root.render(<Home />) })
}
const STARTER = 'Build my own plan'
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Home with no plan', () => {
  it('tells a client who is preparing their programme, and offers no starter plan', async () => {
    mocks.answer = async () => ({ trainer: { id: 't', name: 'Макс' }, plan: null })
    await draw()
    expect(host.textContent).toContain('Ваш тренер Макс готовит программу')
    expect(host.textContent).not.toContain(STARTER)
  })

  it('offers the starter plan to someone without a trainer, or when the server cannot say', async () => {
    mocks.answer = async () => ({ trainer: null, plan: null })
    await draw()
    expect(host.textContent).toContain(STARTER)
    mocks.answer = async () => { throw new Error('offline') }
    await draw({ user: { id: 'u2', name: 'Гость' } })
    expect(host.textContent).toContain(STARTER)
    expect(host.textContent).not.toContain('готовит программу')
  })

  it('shows neither card before the answer, and the plan once there is one', async () => {
    mocks.answer = () => new Promise(() => {})
    await draw()
    expect(host.textContent).not.toContain(STARTER)
    expect(host.textContent).not.toContain('готовит программу')
    await draw({ routines: [{ id: 'r1', name: 'Ноги', ex: [] }] })
    expect(host.textContent).not.toContain('готовит программу')
  })
})
