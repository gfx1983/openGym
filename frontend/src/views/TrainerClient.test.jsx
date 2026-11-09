// @vitest-environment happy-dom
// A client's page must open whatever their state file holds: one shapeless entry must not take
// the trainer's whole screen down, and a refusal must read as a refusal, not as an empty profile.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainerClient from './TrainerClient.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answer: null, urls: [] }))

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useParams: () => ({ id: 'c 1' }) }))
vi.mock('../lib/api.js', () => ({
  api: url => {
    mocks.urls.push(url)
    return mocks.answer instanceof Error ? Promise.reject(mocks.answer) : Promise.resolve(mocks.answer)
  }
}))
vi.mock('../components/LineChart.jsx', () => ({ default: ({ points }) => <div data-testid="chart">{points.length} точек</div> }))

const client = extra => ({
  user: { id: 'c1', name: 'Ира', created: '2026-11-01T10:00:00Z' }, unit: 'kg',
  routines: [], week: {}, bodyweight: [], measurements: [], customEx: [], workouts: [], ...extra
})

let root, host
const render = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<TrainerClient />) })
}

beforeEach(() => { mocks.urls = [] })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
})

describe('TrainerClient', () => {
  it('asks the server for this client, with the id encoded', async () => {
    mocks.answer = client()
    await render()
    expect(mocks.urls).toEqual(['/api/trainer/client?id=c%201'])
  })

  it('shows the refusal, not an empty profile', async () => {
    mocks.answer = new Error('no such client')
    await render()
    expect(host.textContent).toContain('Не удалось загрузить: no such client')
    expect(host.textContent).not.toContain('Тренировок нет')
  })

  it('says what is missing for a client with no data', async () => {
    mocks.answer = client()
    await render()
    for (const line of ['Взвешиваний нет', 'Замеров нет', 'Программ нет', 'Тренировок нет']) expect(host.textContent).toContain(line)
  })

  it('shows weight, measurements, the week, routines and custom exercises by name', async () => {
    mocks.answer = client({
      bodyweight: [{ d: '2026-10-01', w: 60 }, { d: '2026-11-01', w: 58.5 }],
      measurements: [{ d: '2026-11-01', waist: 70 }],
      routines: [{ id: 'r1', name: 'Ноги', ex: [{ id: 'my-ex', sets: 3, reps: 12, weight: 40 }] }],
      week: { 1: ['r1'] },
      customEx: [{ id: 'my-ex', n: 'Моё упражнение' }]
    })
    await render()
    expect(host.textContent).toContain('2 точек')
    expect(host.textContent).toContain('58.5 kg')
    expect(host.textContent).toContain('70 cm')
    expect(host.textContent).toContain('Пн: Ноги')
    expect(host.textContent).toContain('Моё упражнение')
    expect(host.textContent).toContain('3 × 12 · 40')
  })

  it('says when the questionnaire is not filled in, and offers nothing to open', async () => {
    mocks.answer = client({ intake: null })
    await render()
    expect(host.textContent).toContain('Клиент ещё не заполнял')
    expect(host.textContent).not.toContain('Показать')
  })

  it('opens the answers as text and offers the longer part after the short one', async () => {
    mocks.answer = client({ intake: { shortDoneAt: 'x', answers: { sex: 'female', limits: 'yes', limits_details: 'колено' } } })
    await render()
    expect(host.textContent).not.toContain('колено')
    const show = [...host.querySelectorAll('button')].find(b => b.textContent === 'Показать')
    await act(async () => { show.click() })
    expect(host.textContent).toContain('Женский')
    expect(host.textContent).toContain('колено')
    expect(host.textContent).toContain('Попросить расширенную анкету')
  })

  it('skips shapeless entries instead of crashing, and opens a workout to show its sets', async () => {
    mocks.answer = client({
      bodyweight: [null, { d: '2026-11-01' }],
      routines: [null, { id: 'r1', name: 'Спина', ex: [null] }],
      workouts: [null, { id: 'bad', entries: [null] }, { id: 'w1', name: 'Спина', d: '2026-11-02', start: 1, end: 3600001, entries: [{ id: 'my-ex', sets: [{ w: 50, r: 10, done: true }, { w: 60, r: 8 }] }] }]
    })
    await render()
    expect(host.textContent).toContain('Взвешиваний нет')
    const row = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') === 'false')
    await act(async () => { row.click() })
    expect(host.textContent).toContain('50×10')
    expect(host.textContent).not.toContain('60×8')
  })
})
