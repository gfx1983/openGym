// @vitest-environment happy-dom
// Home's client list: only for a trainer, the same clients the trainer's page shows, and a client
// opened from here comes back to Home.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import TrainerClientsHome from './TrainerClientsHome.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answer: null, urls: [], nav: [] }))
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => { mocks.nav.push(a) } }))
vi.mock('../lib/api.js', () => ({
  api: url => {
    mocks.urls.push(url)
    return mocks.answer instanceof Error ? Promise.reject(mocks.answer) : Promise.resolve(mocks.answer)
  }
}))

let root, host
const render = async trainer => {
  useStore.setState({ user: { id: 'u1', name: 'Макс', trainer }, tourSandbox: false })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<TrainerClientsHome />) })
}

beforeEach(() => { mocks.urls = []; mocks.nav = [] })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
})

describe('TrainerClientsHome', () => {
  it('shows nothing and asks nothing for someone who is not a trainer', async () => {
    mocks.answer = { clients: [] }
    await render(false)
    expect(mocks.urls).toEqual([])
    expect(host.textContent).toBe('')
  })

  it('lists the clients with their last workout and questionnaire', async () => {
    mocks.answer = { clients: [
      { id: 'c 1', name: 'Ира', workouts: 3, lastWorkout: '2026-11-08', intake: 'done' },
      { id: 'c2', name: 'Богдан', workouts: 0, lastWorkout: null, intake: 'none' },
    ] }
    await render(true)
    expect(mocks.urls).toEqual(['/api/trainer/clients'])
    expect(host.textContent).toContain('Мои клиенты')
    expect(host.textContent).toContain('Ира')
    expect(host.textContent).toContain('анкета заполнена')
    expect(host.textContent).toContain('Богдан')
    expect(host.textContent).toContain('Тренировок ещё не было')
  })

  it('opens a client with the way back to Home, and the title the trainer\'s page', async () => {
    mocks.answer = { clients: [{ id: 'c 1', name: 'Ира', workouts: 0, intake: 'none' }] }
    await render(true)
    const row = [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Ира'))
    await act(async () => { row.click() })
    expect(mocks.nav).toEqual([['/trainer/client/c%201', { state: { from: '/home' } }]])
    const title = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Мои клиенты'))
    await act(async () => { title.click() })
    expect(mocks.nav[1]).toEqual(['/trainer'])
  })

  it('stays away when the list does not load', async () => {
    mocks.answer = new Error('offline')
    await render(true)
    expect(host.textContent).toBe('')
  })
})
