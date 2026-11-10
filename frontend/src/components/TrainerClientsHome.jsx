import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import Icon from './Icon.jsx'
import CardHead from './CardHead.jsx'

// A trainer's clients on Home, the same list as views/Trainer.jsx, one tap from each client. A
// client opened from here goes back to Home. Codes and invitations stay on the trainer's page.
// Russian-only, like Trainer.jsx.
const INTAKE = { none: 'анкеты нет', draft: 'анкета заполняется', done: 'анкета заполнена' }

export default function TrainerClientsHome() {
  const nav = useNavigate()
  const trainer = useStore(s => !!s.user?.trainer)
  const [clients, setClients] = useState(null)
  useEffect(() => {
    if (!trainer || useStore.getState().tourSandbox) return
    let gone = false
    api('/api/trainer/clients').then(d => { if (!gone) setClients(d.clients || []) }).catch(() => { if (!gone) setClients(null) })
    return () => { gone = true }
  }, [trainer])
  if (!trainer || !clients) return null
  return <div className="card tap-host">
    <CardHead icon="person" tint="var(--indigo)" title="Мои клиенты" open={{ onClick: () => nav('/trainer') }}
      action={<Icon name="chevronRight" className="chev" />} />
    {!clients.length && <div className="dim small" style={{ marginTop: 6 }}>Клиентов пока нет. Коды приглашения — в разделе «Мои клиенты».</div>}
    {clients.map(c => <button key={c.id} className="row between" onClick={() => nav('/trainer/client/' + encodeURIComponent(c.id), { state: { from: '/home' } })}
      style={{ width: '100%', background: 'none', border: 0, borderTop: 'var(--hair) solid var(--sep)', color: 'inherit', padding: '8px 0', textAlign: 'start', gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflowWrap: 'anywhere' }}>{c.name}{c.disabled ? ' · отключён' : ''}</div>
        <div className="dim small">{c.lastWorkout ? 'Последняя тренировка ' + fmtDate(c.lastWorkout) : 'Тренировок ещё не было'}{INTAKE[c.intake] ? ' · ' + INTAKE[c.intake] : ''}</div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </button>)}
  </div>
}
