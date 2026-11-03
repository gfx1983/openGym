// @vitest-environment happy-dom
// The notice says what is already in place and offers the way back; it is gone once read.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainerPlanNotice from './TrainerPlanNotice.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ calls: [], S: null, rerender: null }))
vi.mock('../lib/api.js', () => ({ api: (url, opts) => { mocks.calls.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }) } }))
vi.mock('../store/useStore.js', () => ({
  useStore: pick => pick({ S: mocks.S, update: fn => { const d = JSON.parse(JSON.stringify(mocks.S)); fn(d); mocks.S = d } })
}))
vi.mock('../store/useUI.js', () => ({ useUI: pick => pick({ toast: () => {} }) }))

let root, host
const draw = () => act(async () => { root.render(<TrainerPlanNotice key={Math.random()} />) })
const press = async text => {
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes(text)).click() })
  await draw()
}
beforeEach(async () => {
  mocks.calls.length = 0
  mocks.S = {
    routines: [{ id: 'new' }], week: { 1: ['new'] },
    trainerUndo: { planId: 'p1', trainer: 'Макс', note: 'Пробуем', summary: ['Новая программа: Ноги'], seen: false, snapshot: { routines: [{ id: 'old' }], week: {} } }
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await draw()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the notice', () => {
  it('says who changed what, with the trainer\'s note', () => {
    for (const text of ['Макс', 'Пробуем', 'Новая программа: Ноги']) expect(host.textContent).toContain(text)
    expect(host.textContent).not.toContain('Применить')
  })
  it('goes once read, and keeps what was applied', async () => {
    await press('Понятно')
    expect(host.textContent).toBe('')
    expect(mocks.S.routines).toEqual([{ id: 'new' }])
    expect(mocks.S.trainerUndo.seen).toBe(true)
  })
  it('the way back restores the plan and tells the trainer', async () => {
    await press('Вернуть как было')
    expect(mocks.S.routines).toEqual([{ id: 'old' }])
    expect(mocks.S.trainerUndo).toBeUndefined()
    expect(mocks.calls).toEqual([{ url: '/api/account/trainer/plan/resolve', body: { id: 'p1', decision: 'undone' } }])
    expect(host.textContent).toBe('')
  })
})
