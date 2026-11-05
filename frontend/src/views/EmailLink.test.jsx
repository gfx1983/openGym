// @vitest-environment happy-dom
// Where the links in letters land: a token or a code is read once and leaves the address.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ verifyEmail: vi.fn(), forgotConfirm: vi.fn(), emailSignUp: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), ...mocks }))

import EmailLink, { isEmailLink } from './EmailLink.jsx'
import { useStore } from '../store/useStore.js'

let root, host
// The real address holds the secret too, so that its leaving is something a test can see fail.
const open = async entry => {
  window.history.replaceState(null, '', '#' + entry)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><EmailLink /></MemoryRouter>) })
}
const type = (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
})
const submit = () => act(async () => { host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
const inputs = sel => [...host.querySelectorAll(sel)]

beforeEach(() => {
  mocks.verifyEmail.mockReset(); mocks.forgotConfirm.mockReset(); mocks.emailSignUp.mockReset()
  useStore.setState({ user: null, config: { invite_only: true, email_auth: true, password_login: true }, loadConfig: async () => {} })
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
})

describe('EmailLink', () => {
  it('knows its addresses and nothing else', () => {
    expect(isEmailLink('/verify-email')).toBe(true)
    expect(isEmailLink('/reset-password')).toBe(true)
    expect(isEmailLink('/invite')).toBe(true)
    expect(isEmailLink('/home')).toBe(false)
  })

  it('confirms the address once and sends the person to sign in', async () => {
    mocks.verifyEmail.mockResolvedValue({ ok: true })
    await open('/verify-email?token=abc')
    expect(host.textContent).toContain('Адрес подтверждён')
    expect(mocks.verifyEmail).toHaveBeenCalledTimes(1)
    expect(mocks.verifyEmail).toHaveBeenCalledWith('abc')
    expect(window.location.hash).toBe('#/verify-email')
  })

  it('says a used or expired link is one, and points at a new letter', async () => {
    mocks.verifyEmail.mockRejectedValue(Object.assign(new Error('x'), { status: 400, data: { code: 'email-token-invalid' } }))
    await open('/verify-email?token=old')
    expect(host.textContent).toContain('адрес подтверждён: просто войдите')
  })

  it('asks nothing of the server without a token', async () => {
    await open('/verify-email')
    expect(host.textContent).toContain('Не получилось')
    expect(mocks.verifyEmail).not.toHaveBeenCalled()
  })

  it('fills in the code from an invitation, signs up with it and takes it out of the address', async () => {
    mocks.emailSignUp.mockResolvedValue({ needsVerification: true })
    await open('/invite?code=ABC123')
    expect(window.location.hash).toBe('#/invite')
    expect(inputs('input').map(i => i.value)).toContain('ABC123')
    await type(host.querySelector('input[name=username]'), 'Ира')
    await type(host.querySelector('input[type=email]'), 'ira@example.com')
    for (const input of inputs('input[type=password]')) await type(input, 'long enough to pass 17')
    await submit()
    expect(mocks.emailSignUp).toHaveBeenCalledWith('Ира', 'long enough to pass 17', 'ABC123', 'ira@example.com')
    expect(host.textContent).toContain('Мы отправили письмо на ira@example.com')
  })

  it('does not offer a second profile to someone already signed in', async () => {
    useStore.setState({ user: { id: 'u1', name: 'Макс' } })
    await open('/invite?code=ABC123')
    expect(host.textContent).toContain('Вы уже вошли')
    expect(host.querySelector('form')).toBeNull()
  })

  it('refuses a short or mistyped password before asking the server', async () => {
    await open('/reset-password?token=abc')
    expect(window.location.hash).toBe('#/reset-password')
    const [next, again] = inputs('input[type=password]')
    await type(next, 'short')
    await submit()
    expect(host.querySelector('[role=alert]').textContent).toMatch(/не меньше/i)
    await type(next, 'long enough to pass 17')
    await type(again, 'not the same one at all')
    await submit()
    expect(host.querySelector('[role=alert]').textContent).toBe('Пароли не совпадают.')
    expect(mocks.forgotConfirm).not.toHaveBeenCalled()

    mocks.forgotConfirm.mockResolvedValue({ ok: true })
    await type(again, 'long enough to pass 17')
    await submit()
    expect(host.textContent).toContain('Пароль изменён')
    expect(mocks.forgotConfirm).toHaveBeenCalledWith('abc', 'long enough to pass 17')
  })
})
