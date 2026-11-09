// @vitest-environment happy-dom
// The switch that opens a client's photos: off unless the server says on, and absent without a trainer.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainerPhotosRow from './TrainerPhotosRow.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ d: null, posts: [] }))
vi.mock('../lib/api.js', () => ({
  api: async (url, opts) => {
    if (!opts) return mocks.d
    const body = JSON.parse(opts.body)
    mocks.posts.push(body)
    return { photosShared: body.on }
  }
}))

let root, host
const draw = async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<TrainerPhotosRow />) })
}
beforeEach(() => { mocks.posts = [] })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

describe('TrainerPhotosRow', () => {
  it('is absent without a trainer', async () => {
    mocks.d = { trainer: null }
    await draw()
    expect(host.textContent).toBe('')
  })
  it('starts off and asks the server to open the photos', async () => {
    mocks.d = { trainer: { name: 'Макс' }, photosShared: false }
    await draw()
    const sw = host.querySelector('[aria-label="Показывать фото тренеру"]')
    expect(sw.checked ?? sw.getAttribute('aria-checked') === 'true').toBe(false)
    await act(async () => { sw.click() })
    expect(mocks.posts).toEqual([{ on: true }])
  })
})
