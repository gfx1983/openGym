import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { passwordError, looksLikeEmail } from '../components/PasswordAuth.jsx'
import '../admin.css'

// The trainer's page: their own clients and the codes that sign new ones up. The server answers
// about the caller's own clients only. Russian-only for now: this fork serves one Russian-speaking
// group, so the strings stay out of the 19 language packs, which keeps merges from upstream clean.

// Only where the server can send letters: the code then goes straight to the person.
function SendInvite({ reload }) {
  const toast = useUI(s => s.toast)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const to = email.trim()
    if (!looksLikeEmail(to)) { setErr('Укажите адрес электронной почты.'); return }
    setBusy(true); setErr(null)
    try {
      await api('/api/trainer/invites/send', { method: 'POST', body: JSON.stringify({ email: to }) })
      toast('Приглашение отправлено на ' + to)
      setEmail('')
      reload()
    } catch (e) { setErr(passwordError(e)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} noValidate style={{ marginBottom: 12 }}>
    <input className="input" type="email" autoComplete="off" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254}
      placeholder="Адрес клиента" aria-label="Адрес клиента" value={email} onChange={e => setEmail(e.target.value)} />
    {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 6 }}>{err}</div>}
    <div style={{ height: 8 }} />
    <Button type="submit" variant="primary" disabled={busy}>Отправить приглашение</Button>
  </form>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const emailAuth = !!useStore(s => s.config)?.email_auth
  const gen = () => api('/api/trainer/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast('Код ' + invite.code + ' создан и скопирован'); reload() })
    .catch(e => toast(e.message))
  const revoke = code => confirmSheet({
    title: 'Отозвать код ' + code + '?',
    message: 'Этим кодом больше нельзя будет зарегистрироваться.',
    confirmText: 'Отозвать', danger: true,
    onConfirm: () => api('/api/trainer/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => { toast('Код отозван'); reload() }).catch(e => toast(e.message))
  })
  const copy = code => { navigator.clipboard?.writeText(code).catch(() => {}); toast('Скопировано: ' + code) }
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Коды приглашения</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">Новый код</Button></div>
    <div className="adm-lead">Человек, который зарегистрируется по такому коду, станет вашим клиентом. Каждый код работает один раз.</div>
    {emailAuth && <SendInvite reload={reload} />}
    {invites?.length ? invites.map(i => <div key={i.code} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
      <div style={{ minWidth: 0 }}>
        <button className="adm-code" onClick={() => copy(i.code)} aria-label={'Скопировать ' + i.code}>{i.code}</button>
        {i.sentTo && <div className="dim small" style={{ overflowWrap: 'anywhere' }}>Отправлен: {i.sentTo}</div>}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn adm-iconbtn" onClick={() => copy(i.code)} aria-label="Скопировать"><Icon name="copy" /></button>
        <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="Отозвать"><Icon name="trash" /></button>
      </div>
    </div>) : <div className="adm-empty">Неиспользованных кодов нет.</div>}
  </div>
}

function ClientsCard({ clients, error, open }) {
  return <div className="card">
    <h2 style={{ margin: 0 }}>Клиенты</h2>
    {error ? <div className="adm-empty">Не удалось загрузить: {error}</div>
      : !clients ? <div className="adm-empty">Загрузка…</div>
      : !clients.length ? <div className="adm-empty">Клиентов пока нет. Создайте код и отправьте его человеку.</div>
      : clients.map(c => <button key={c.id} className="row between" onClick={() => open(c.id)} style={{ width: '100%', background: 'none', border: 0, borderBottom: 'var(--hair) solid var(--sep)', color: 'inherit', padding: '8px 0', textAlign: 'start' }}>
        <div>
          <div>{c.name}{c.disabled ? ' · отключён' : ''}</div>
          <div className="dim small">С нами с {c.created ? fmtDate(c.created.slice(0, 10)) : '–'}</div>
        </div>
        <div className="dim small" style={{ textAlign: 'end' }}>
          <div>Тренировок: {c.workouts}</div>
          <div>{c.lastWorkout ? 'Последняя: ' + fmtDate(c.lastWorkout) : 'Тренировок ещё не было'}</div>
        </div>
      </button>)}
  </div>
}

export default function Trainer() {
  const nav = useNavigate()
  const [clients, setClients] = useState(null)
  const [clientsErr, setClientsErr] = useState(null)
  const [invites, setInvites] = useState(null)
  const loadClients = () => api('/api/trainer/clients').then(d => { setClients(d.clients); setClientsErr(null) }).catch(e => setClientsErr(e.message))
  const loadInvites = () => api('/api/trainer/invites').then(d => setInvites(d.invites)).catch(() => {})
  useEffect(() => { loadClients(); loadInvites() }, [])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings/account" onClick={() => nav('/settings/account')} aria-label="Назад"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>Мои клиенты</h1></div>
      <button className="iconbtn" onClick={() => { loadClients(); loadInvites() }} aria-label="Обновить">↻</button>
    </div>
    <ClientsCard clients={clients} error={clientsErr} open={id => nav('/trainer/client/' + encodeURIComponent(id))} />
    <InvitesCard invites={invites} reload={loadInvites} />
  </div>
}
