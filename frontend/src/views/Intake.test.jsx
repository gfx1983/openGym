// @vitest-environment happy-dom
// Consent comes before any question, nothing is saved without it, and each step is saved as it is left.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Intake from './Intake.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ d: null, posts: [], nav: null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav, useSearchParams: () => [new URLSearchParams('')] }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: async (url, opts) => {
    if (!opts) return mocks.d
    const body = JSON.parse(opts.body)
    mocks.posts.push(body)
    return { intake: { answers: body.answers, consentAt: 'x' } }
  }
}))

let root, host
const draw = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Intake />) })
}
const press = async label => {
  const b = [...host.querySelectorAll('button')].find(x => x.textContent === label)
  await act(async () => { b.click() })
}
const button = label => [...host.querySelectorAll('button')].find(x => x.textContent === label)
const type = async (name, value) => {
  const el = host.querySelector(`[aria-label="${name}"]`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => { mocks.posts = []; mocks.nav = vi.fn() })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

describe('Intake', () => {
  it('sends someone without a trainer home', async () => {
    mocks.d = { trainer: null, intake: null }
    await draw()
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
  })
  it('asks for consent first, names the trainer, and saves nothing until given', async () => {
    mocks.d = { trainer: { name: 'Макс' }, intake: null }
    await draw()
    expect(host.textContent).toContain('Ответы в приложении видит только Макс')
    expect(host.textContent).not.toContain('Шаг 1')
    expect(mocks.posts).toEqual([])
  })
  it('holds Next until the step is answered, then saves it with the consent', async () => {
    mocks.d = { trainer: { name: 'Макс' }, intake: null }
    await draw()
    await press('Согласиться и продолжить')
    expect(host.textContent).toContain('Шаг 1 из 7')
    expect(button('Далее').disabled).toBe(true)
    await press('Женский')
    await type('Возраст, лет', '30')
    await type('Рост, см', '170')
    await type('Вес, кг', '60')
    expect(button('Далее').disabled).toBe(false)
    await press('Далее')
    expect(mocks.posts[0]).toEqual({ answers: { sex: 'female', age: '30', height: '170', weight: '60' }, consent: true })
    expect(host.textContent).toContain('Шаг 2 из 7')
  })
  it('shows a finished questionnaire as a summary that can be deleted', async () => {
    mocks.d = { trainer: { name: 'Макс' }, intake: { shortDoneAt: 'x', answers: { sex: 'male' } } }
    await draw()
    expect(host.textContent).toContain('Мужской')
    expect(button('Удалить анкету')).toBeTruthy()
  })
})
