// Where the links in sign-in letters land (api/mail.js), signed in or not. A letter usually opens
// in a browser and not in the installed app, so neither screen signs in here: each sends the person
// back to sign in wherever they use the app. The token is read once and taken out of the address,
// and so is the code in a trainer's invitation.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { verifyEmail, forgotConfirm } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { passwordError, MIN_PASSWORD, PasswordRegisterForm } from '../components/PasswordAuth.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export const isEmailLink = pathname => pathname === '/verify-email' || pathname === '/reset-password' || pathname === '/invite'

const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
const errStyle = { color: 'var(--red)', marginTop: 10 }
const toSignIn = () => { window.location.hash = '#/home' }

function useLinkParam(pathname, search, key) {
  const [token] = useState(() => new URLSearchParams(search).get(key) || '')
  useEffect(() => { window.history.replaceState(null, '', '#' + pathname) }, [pathname])
  return token
}

function Page({ title, children }) {
  return <div className="narrow" style={wrap}>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc-ink)' }}><Icon name="dumbbell" /></div>
    <h1 className="t-large" style={{ fontWeight: 700, margin: '10px 0 16px' }}>{title}</h1>
    {children}
  </div>
}

const Finished = ({ text, button = 'Перейти ко входу' }) => <>
  <div className="muted" style={{ marginBottom: 24 }}>{text}</div>
  <Button variant="primary" onClick={toSignIn}>{button}</Button>
</>

function VerifyEmail({ token }) {
  const [state, setState] = useState(token ? 'busy' : 'bad')
  const [err, setErr] = useState(null)
  const asked = useRef(false)
  useEffect(() => {
    // Single use on the server, so never twice from here.
    if (!token || asked.current) return
    asked.current = true
    verifyEmail(token).then(() => setState('done')).catch(e => { setErr(explain(e)); setState('bad') })
  }, [token])
  if (state === 'busy') return <Page title="Проверяем ссылку…" />
  if (state === 'done') return <Page title="Адрес подтверждён"><Finished text="Откройте openGym и войдите с адресом и паролем." /></Page>
  return <Page title="Не получилось"><Finished text={!err || err === LINK_BAD ? VERIFY_BAD : err} /></Page>
}

function ResetPassword({ token }) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(token ? null : LINK_BAD)
  const [done, setDone] = useState(false)
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const bad = [...next].length < MIN_PASSWORD ? `Используйте не меньше ${MIN_PASSWORD} символов.`
      : next !== again ? 'Пароли не совпадают.'
      : null
    if (bad) { setErr(bad); return }
    setBusy(true); setErr(null)
    try { await forgotConfirm(token, next); setDone(true) }
    catch (e) { setErr(explain(e)) }
    finally { setBusy(false) }
  }
  if (done) return <Page title="Пароль изменён"><Finished text="Откройте openGym и войдите с новым паролем. На других устройствах вход нужно будет повторить." /></Page>
  return <Page title="Новый пароль">
    <form onSubmit={submit} noValidate style={{ textAlign: 'start' }}>
      <input className="input" type="password" name="new-password" autoComplete="new-password" placeholder="Новый пароль"
        value={next} onChange={e => setNext(e.target.value)} />
      <div style={{ height: 10 }} />
      <input className="input" type="password" name="new-password-again" autoComplete="new-password" placeholder="Повторите пароль"
        value={again} onChange={e => setAgain(e.target.value)} />
      <div className="dim small" style={{ marginTop: 6 }}>{`Не меньше ${MIN_PASSWORD} символов. Хорошо подходят несколько несвязанных слов.`}</div>
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy || !token}>Сохранить пароль</Button>
    </form>
  </Page>
}

// The sign-up form with the code filled in. Someone already signed in here would make a second
// profile by accident, so they are told instead.
function Invite({ code: fromLink }) {
  const signedIn = useStore(s => !!s.user)
  const config = useStore(s => s.config)
  const loadConfig = useStore(s => s.loadConfig)
  const [name, setName] = useState('')
  const [code, setCode] = useState(fromLink)
  useEffect(() => { loadConfig() }, [loadConfig])
  if (signedIn) return <Page title="Приглашение в openGym"><Finished text="Вы уже вошли в профиль. Чтобы создать новый по приглашению, сначала выйдите и откройте ссылку снова." button="Открыть openGym" /></Page>
  return <Page title="Приглашение в openGym">
    <div className="muted small" style={{ marginBottom: 14 }}>Укажите имя, адрес и пароль. Войти можно будет после подтверждения адреса по ссылке из письма.</div>
    <div style={{ textAlign: 'start' }}>
      <PasswordRegisterForm close={toSignIn} inviteOnly={!!config?.invite_only} name={name} setName={setName} code={code} setCode={setCode} />
    </div>
  </Page>
}

const LINK_BAD = 'Ссылка неверна или устарела. Запросите новое письмо на экране входа.'
// Opening the link a second time is the likely way here, and the address is proven by then.
const VERIFY_BAD = 'Ссылка неверна, устарела или уже использована. Если вы уже открывали её, адрес подтверждён: просто войдите. Иначе запросите новое письмо на экране входа.'
const explain = e => (e?.data?.code === 'email-token-invalid' ? LINK_BAD : passwordError(e))

export default function EmailLink() {
  const { pathname, search } = useLocation()
  const token = useLinkParam(pathname, search, pathname === '/invite' ? 'code' : 'token')
  if (pathname === '/invite') return <Invite code={token} />
  return pathname === '/reset-password' ? <ResetPassword token={token} /> : <VerifyEmail token={token} />
}
