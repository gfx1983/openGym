// @vitest-environment happy-dom
// A client sees who follows their training and can leave. The row must go once the server has
// unlinked them, even when the sheet closing remounted it and its first request lost the race.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyTrainerRow from './MyTrainerRow.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ trainer: null, calls: [], sheet: null, toast: () => {} }))

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: (url, opts) => {
    mocks.calls.push([url, opts?.method || 'GET'])
    if (opts?.method === 'POST') { mocks.trainer = null; return Promise.resolve({ ok: true }) }
    return Promise.resolve({ trainer: mocks.trainer })
  }
}))
vi.mock('../store/useUI.js', () => ({ useUI: select => select({ toast: (...a) => mocks.toast(...a) }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: opts => { mocks.sheet = opts } }))
vi.mock('./ui.jsx', () => ({ Row: ({ title, subtitle, onClick }) => <button onClick={onClick}>{title} {subtitle}</button> }))

let root, host
const render = async node => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(node) })
}

beforeEach(() => { mocks.calls = []; mocks.sheet = null; mocks.toast = vi.fn(); mocks.trainer = { name: 'Макс' } })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
})

describe('MyTrainerRow', () => {
  it('is absent for a profile with no trainer', async () => {
    mocks.trainer = null
    await render(<MyTrainerRow />)
    expect(host.textContent).toBe('')
  })

  it('names the trainer, and says what they see', async () => {
    await render(<MyTrainerRow />)
    expect(host.textContent).toContain('Мой тренер: Макс')
    expect(host.textContent).toContain('тренировки, вес, замеры и программы')
  })

  it('unlinks only after the confirmation', async () => {
    await render(<MyTrainerRow />)
    await act(async () => { host.querySelector('button').click() })
    expect(mocks.calls.some(c => c[1] === 'POST')).toBe(false)
    expect(mocks.sheet.danger).toBe(true)
    await act(async () => { mocks.sheet.onConfirm() })
    expect(mocks.calls).toContainEqual(['/api/account/trainer/unlink', 'POST'])
    expect(host.textContent).toBe('')
  })

  it('goes away on a row mounted while the unlink was still on its way', async () => {
    await render(<MyTrainerRow />)
    await act(async () => { host.querySelector('button').click() })
    // The sheet closes and remounts the row: its request answers with the trainer still there.
    await act(async () => { root.render(<React.Fragment key="again"><MyTrainerRow /></React.Fragment>) })
    expect(host.textContent).toContain('Мой тренер: Макс')
    await act(async () => { mocks.sheet.onConfirm() })
    expect(host.textContent).toBe('')
  })
})
