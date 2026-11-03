// @vitest-environment happy-dom
// What the trainer's sheet sends: a rest day stays a rest day, and a client's routine that has a
// copy going out is scheduled as that copy.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainerSendPlan from './TrainerSendPlan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ sent: [], S: null }))
vi.mock('../lib/api.js', () => ({
  api: (url, opts) => { mocks.sent.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ plan: { id: 'p', status: 'pending' } }) }
}))
vi.mock('../store/useStore.js', () => ({ useStore: pick => pick({ S: mocks.S }) }))
vi.mock('../store/useUI.js', () => ({ useUI: pick => pick({ toast: () => {} }) }))

const client = extra => ({
  user: { id: 'c1', name: 'Ира' }, unit: 'kg', customEx: [],
  routines: [{ id: 'leg', name: 'Ноги', ex: [] }, { id: 'back', name: 'Спина', ex: [] }],
  week: { 1: ['leg'], 4: ['back'] }, ...extra
})

let root, host
const render = async props => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<TrainerSendPlan close={() => {}} onSent={() => {}} {...props} />) })
}
const clickByText = async text => {
  const el = [...host.querySelectorAll('label, button')].find(x => x.textContent.includes(text))
  await act(async () => { el.querySelector('input') ? el.querySelector('input').click() : el.click() })
}

beforeEach(() => {
  mocks.sent.length = 0
  mocks.S = { unit: 'kg', customEx: [], week: {}, routines: [
    { id: 'tpl', name: 'Шаблон', ex: [] },
    { id: 'copy', name: 'Ноги v2', clientCopy: { client: 'c1', routine: 'leg' }, ex: [] },
    { id: 'theirs', name: 'Чужая', clientCopy: { client: 'c2', routine: 'x' }, ex: [] },
  ] }
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the trainer\'s send sheet', () => {
  it('starts with this client\'s copies picked and leaves out another client\'s', async () => {
    await render({ client: client() })
    expect(host.textContent).not.toContain('Чужая')
    const boxes = [...host.querySelectorAll('label')].filter(l => l.querySelector('input')?.checked)
    expect(boxes.map(l => l.textContent)).toEqual([expect.stringContaining('Ноги v2')])
  })

  it('keeps rest days and schedules the copy where the client\'s routine was', async () => {
    await render({ client: client() })
    await clickByText('Шаблон')
    await clickByText('Заменить расписание')
    await clickByText('Отправить')
    const { body } = mocks.sent[0]
    expect(body.schedule).toBe(true)
    expect(body.bundle.week).toEqual({ 1: ['copy'], 4: ['back'] })
    expect(body.targets).toEqual({ copy: 'leg' })
    expect(body.bundle.routines.map(r => r.id).sort()).toEqual(['copy', 'tpl'])
  })

  it('does not offer the week while a programme or a rotation owns it', async () => {
    await render({ client: client({ scheduleLocked: true }) })
    expect(host.textContent).toContain('цикл или ротация')
    expect(host.textContent).not.toContain('Заменить расписание')
  })
})
