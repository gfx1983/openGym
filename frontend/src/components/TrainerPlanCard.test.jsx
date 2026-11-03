// @vitest-environment happy-dom
// A client's decision: nothing changes before Apply, Apply changes the profile and tells the server,
// Decline only tells the server, and a plan settled elsewhere is not an error.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIDX } from '../lib/exercises.js'
import TrainerPlanCard from './TrainerPlanCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ calls: [], answer: null, S: null, refuse: null, toasts: [] }))
vi.mock('../lib/api.js', () => ({
  api: (url, opts) => {
    if (!opts) return Promise.resolve(mocks.answer)
    mocks.calls.push({ url, body: JSON.parse(opts.body) })
    return mocks.refuse ? Promise.reject(mocks.refuse) : Promise.resolve({ ok: true })
  }
}))
vi.mock('../store/useStore.js', () => {
  const update = fn => {
    const draft = JSON.parse(JSON.stringify(mocks.S))
    fn(draft)
    mocks.S = draft
  }
  const useStore = pick => pick({ S: mocks.S, update })
  useStore.getState = () => ({ S: mocks.S, update })
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: pick => pick({ toast: m => mocks.toasts.push(m) }) }))

const id = Object.keys(EXIDX)[0]
const plan = () => ({
  id: 'p1', note: 'Попробуй', schedule: false, removed: [], targets: {},
  bundle: { opengym_plan: 1, unit: 'kg', week: {}, customEx: [], routines: [{ id: 'tr', name: 'Новая', ex: [{ id, sets: 3, reps: 8 }] }] }
})

let root, host
const render = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<TrainerPlanCard />) })
}
const press = async text => {
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes(text)).click() })
}

beforeEach(() => {
  mocks.calls.length = 0; mocks.toasts.length = 0; mocks.refuse = null
  mocks.S = { unit: 'kg', routines: [{ id: 'mine', name: 'Моя', ex: [] }], week: {}, customEx: [] }
  mocks.answer = { trainer: { id: 'T', name: 'Макс' }, plan: plan() }
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the plan card', () => {
  it('shows nothing without a waiting plan', async () => {
    mocks.answer = { trainer: { id: 'T', name: 'Макс' }, plan: null }
    await render()
    expect(host.textContent).toBe('')
  })

  it('changes nothing until Apply, then applies, reports and offers the way back', async () => {
    await render()
    expect(host.textContent).toContain('Макс')
    expect(host.textContent).toContain('Попробуй')
    expect(mocks.S.routines).toHaveLength(1)
    expect(mocks.calls).toEqual([])

    await press('Применить')
    expect(mocks.S.routines.map(r => r.name)).toEqual(['Моя', 'Новая'])
    expect(mocks.calls[0]).toEqual({ url: '/api/account/trainer/plan/resolve', body: { id: 'p1', decision: 'applied' } })

    await press('Вернуть как было')
    expect(mocks.S.routines.map(r => r.name)).toEqual(['Моя'])
    expect(host.textContent).toBe('')
    expect(mocks.calls[1].body).toEqual({ id: 'p1', decision: 'undone' })
  })

  it('Decline leaves the profile alone', async () => {
    await render()
    await press('Отклонить')
    expect(mocks.S.routines).toHaveLength(1)
    expect(mocks.calls[0].body.decision).toBe('declined')
    expect(host.textContent).toBe('')
  })

  it('a plan already settled on another device is not an error', async () => {
    mocks.refuse = Object.assign(new Error('gone'), { code: 'stale', status: 409 })
    await render()
    await press('Применить')
    expect(mocks.S.routines).toHaveLength(2)
    expect(mocks.toasts).toEqual([])
  })

  it('a server that cannot be reached says so, and the plan stays to try again', async () => {
    mocks.refuse = Object.assign(new Error('Нет сети'), { status: 0 })
    await render()
    await press('Применить')
    expect(mocks.toasts).toEqual(['Нет сети'])
    expect(host.textContent).toContain('Применить')
  })

  it('a plan this version cannot read does not take Home down', async () => {
    mocks.answer = { trainer: { id: 'T', name: 'Макс' }, plan: { id: 'x', bundle: { routines: 'no' } } }
    await render()
    expect(host.textContent).toBe('')
  })
})
