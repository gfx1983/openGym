// @vitest-environment happy-dom
// The trainer's page: it shows what the server answers for the caller and turns its codes over.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Trainer from './Trainer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answers: {}, calls: [], toast: () => {}, nav: () => {}, config: {} }))

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
vi.mock('../store/useStore.js', () => ({ useStore: select => select({ config: mocks.config }) }))
vi.mock('../components/PasswordAuth.jsx', () => ({ passwordError: e => 'понятно: ' + e.message, looksLikeEmail: s => s.includes('@') }))

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
  mocks.config = {}
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

  it('offers no letter where the server cannot send one', async () => {
    await render()
    expect(host.querySelector('input[type=email]')).toBeNull()
  })

  const typeAddress = async value => {
    const input = host.querySelector('input[type=email]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  }
  const send = () => act(async () => { host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })

  it('sends a code to an address, says so, reloads the list and shows who has it', async () => {
    mocks.config = { email_auth: true }
    mocks.answers['/api/trainer/invites/send'] = { invite: { code: 'SENT0001' } }
    mocks.answers['/api/trainer/invites'] = { invites: [{ code: 'SENT0001', sentTo: 'ira@example.com' }] }
    await render()
    expect(host.textContent).toContain('Отправлен: ira@example.com')
    await typeAddress('ira@example.com')
    mocks.calls = []
    await send()
    expect(mocks.calls).toEqual([['/api/trainer/invites/send', 'POST'], ['/api/trainer/invites', 'GET']])
    expect(mocks.toast).toHaveBeenCalledWith('Приглашение отправлено на ira@example.com')
  })

  it('keeps the address and explains when the letter is refused', async () => {
    mocks.config = { email_auth: true }
    mocks.answers['/api/trainer/invites/send'] = new Error('нет')
    await render()
    await typeAddress('ira@example.com')
    await send()
    expect(host.querySelector('[role=alert]').textContent).toBe('понятно: нет')
    expect(host.querySelector('input[type=email]').value).toBe('ira@example.com')
  })

  it('asks the server nothing for something that is not an address', async () => {
    mocks.config = { email_auth: true }
    await render()
    await typeAddress('not an address')
    mocks.calls = []
    await send()
    expect(mocks.calls).toEqual([])
    expect(host.querySelector('[role=alert]')).not.toBeNull()
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
