// @vitest-environment happy-dom
// A new client's modules are set once the account's own copy is here, and only for a client.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import TrainerPlanSync from './TrainerPlanSync.jsx'

const mocks = vi.hoisted(() => ({ trainer: null }))
vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal()),
  api: async () => ({ trainer: mocks.trainer, plan: null }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const set = async (patch, S = {}) => {
  useStore.setState(s => ({ ready: true, user: { id: 'u1', name: 'Б' }, tourSandbox: null, ...patch, S: { ...s.S, workouts: [], active: null, modules: {}, ...S } }))
  await act(async () => { root.render(<TrainerPlanSync />) })
}
const ok = { status: 'ok', lastSynced: 1 }
beforeEach(() => {
  mocks.trainer = { id: 't', name: 'Макс' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('TrainerPlanSync: a new client\'s modules', () => {
  it('waits for the first sync, then sets them', async () => {
    await set({ sync: { status: 'syncing', lastSynced: 0 } })
    expect(useStore.getState().S.modules).toEqual({})
    await set({ sync: ok })
    expect(useStore.getState().S.modules).toMatchObject({ body: true, coach: false, motivation: false })
  })

  it('leaves someone without a trainer alone', async () => {
    mocks.trainer = null
    await set({ sync: ok })
    expect(useStore.getState().S.modules).toEqual({})
  })

  it('keeps a choice the account already holds', async () => {
    await set({ sync: ok }, { modules: { seasonal: true } })
    expect(useStore.getState().S.modules).toEqual({ seasonal: true })
  })
})
