// @vitest-environment happy-dom
// The trainer's page: it shows what the server answers for the caller and turns its codes over.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Trainer from './Trainer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answers: {}, calls: [], toast: () => {}, nav: () => {} }))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/api.js', () => ({
  api: (url, opts) => {
    mocks.calls.push([url, opts?.method || 'GET'])
    const a = mocks.answers[url]
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
  }
}))
vi.mock('../store/useUI.js', () => ({ useUI: select => select({ toast: (...a) => mocks.toast(...a) }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

let root, host
const render = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Trainer />) })
}

beforeEach(() => {
  mocks.calls = []
  mocks.toast = vi.fn()
  mocks.nav = vi.fn()
  mocks.answers = {
    '/api/trainer/clients': { clients: [{ id: 'c1', name: 'Ира', created: '2026-11-01T10:00:00Z', workouts: 3, lastWorkout: '2026-11-02' }] },
    '/api/trainer/invites': { invites: [{ code: 'ABCD1234' }] },
    '/api/trainer/invites/new': { invite: { code: 'NEWCODE1' } }
  }
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
})

describe('Trainer', () => {
  it('lists the clients and the unused codes', async () => {
    await render()
    expect(host.textContent).toContain('Ира')
    expect(host.textContent).toContain('Тренировок: 3')
    expect(host.textContent).toContain('ABCD1234')
  })

  it('opens a client', async () => {
    await render()
    const row = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Ира'))
    await act(async () => { row.click() })
    expect(mocks.nav).toHaveBeenCalledWith('/trainer/client/c1')
  })

  it('says so when there are no clients yet', async () => {
    mocks.answers['/api/trainer/clients'] = { clients: [] }
    await render()
    expect(host.textContent).toContain('Клиентов пока нет')
  })

  it('shows the refusal instead of an empty list when the server says no', async () => {
    mocks.answers['/api/trainer/clients'] = new Error('forbidden')
    await render()
    expect(host.textContent).toContain('Не удалось загрузить: forbidden')
    expect(host.textContent).not.toContain('Клиентов пока нет')
  })

  it('asks the server for a code, announces it and reloads the list', async () => {
    await render()
    const button = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Новый код'))
    mocks.calls = []
    await act(async () => { button.click() })
    expect(mocks.calls).toEqual([['/api/trainer/invites/new', 'POST'], ['/api/trainer/invites', 'GET']])
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('NEWCODE1'))
  })
})
