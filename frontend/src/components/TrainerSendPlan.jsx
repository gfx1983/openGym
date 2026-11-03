import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { buildTrainerPlan } from '../lib/trainer-plan.js'
import { Button, TextArea } from './ui.jsx'

// The trainer's half of a plan: which of their own routines go, what the week should be, and what
// goes away. Russian-only, like views/Trainer.jsx.

const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']]
const REST = ''
const Check = ({ checked, onChange, children }) => <label className="row small" style={{ gap: 8, padding: '6px 0', alignItems: 'center' }}>
  <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{children}</span>
</label>

export default function TrainerSendPlan({ client, close, onSent }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const id = client.user.id
  // Copies made for another client are not this one's to get.
  const mine = useMemo(() => (S.routines || []).filter(r => !r.clientCopy || r.clientCopy.client === id), [S.routines, id])
  const [picked, setPicked] = useState(() => mine.filter(r => r.clientCopy?.client === id).map(r => r.id))
  const [removed, setRemoved] = useState([])
  const [useWeek, setUseWeek] = useState(false)
  const [week, setWeek] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (list, set, v, on) => set(on ? [...list, v] : list.filter(x => x !== v))
  const clientRoutines = (client.routines || []).filter(r => r && r.id)
  const replaced = new Set(mine.filter(r => picked.includes(r.id)).map(r => r.clientCopy?.routine).filter(Boolean))
  const removable = clientRoutines.filter(r => !replaced.has(r.id))
  const kept = removable.filter(r => !removed.includes(r.id))
  const options = [...mine.filter(r => picked.includes(r.id)), ...kept]
  const dayValue = d => {
    if (week[d] !== undefined) return options.some(o => o.id === week[d]) ? week[d] : REST
    const current = [].concat(client.week?.[d] ?? [])[0]
    if (!current) return REST
    const copy = mine.find(r => picked.includes(r.id) && r.clientCopy?.routine === current)
    return copy ? copy.id : options.some(o => o.id === current) ? current : REST
  }
  const send = async () => {
    setBusy(true)
    try {
      const schedule = useWeek ? Object.fromEntries(DAYS.map(([d]) => [d, dayValue(d)]).filter(([, v]) => v).map(([d, v]) => [d, [v]])) : null
      const body = buildTrainerPlan(S, { client: id, routineIds: picked, week: schedule, removed: removed.filter(r => !replaced.has(r)), note })
      const { plan } = await api('/api/trainer/client/plan', { method: 'POST', body: JSON.stringify(body) })
      toast('Отправлено. Клиент увидит программу на главной')
      onSent(plan)
      close()
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  const empty = !picked.length && !removed.length && !useWeek
  return <div style={{ padding: '4px 4px 12px' }}>
    <h2 style={{ marginTop: 0 }}>Отправить: {client.user.name}</h2>
    <div className="small" style={{ fontWeight: 600, marginTop: 8 }}>Из вашего плана</div>
    {mine.length
      ? mine.map(r => <Check key={r.id} checked={picked.includes(r.id)} onChange={on => toggle(picked, setPicked, r.id, on)}>
        {r.name}{r.clientCopy ? ' — заменит программу клиента' : ''}
      </Check>)
      : <div className="adm-empty">В вашем плане нет программ. Создайте её на вкладке «План».</div>}
    {removable.length > 0 && <>
      <div className="small" style={{ fontWeight: 600, marginTop: 10 }}>Убрать у клиента</div>
      {removable.map(r => <Check key={r.id} checked={removed.includes(r.id)} onChange={on => toggle(removed, setRemoved, r.id, on)}>{r.name}</Check>)}
    </>}
    <div className="small" style={{ fontWeight: 600, marginTop: 10 }}>Расписание</div>
    {client.scheduleLocked
      ? <div className="dim small" style={{ padding: '6px 0' }}>У клиента идёт цикл или ротация, поэтому недельное расписание сейчас не изменить.</div>
      : <>
        <Check checked={useWeek} onChange={setUseWeek}>Заменить расписание на неделю</Check>
        {useWeek && DAYS.map(([d, label]) => <label key={d} className="row between small" style={{ padding: '4px 0', gap: 12 }}>
          <span>{label}</span>
          <select value={dayValue(d)} onChange={e => setWeek({ ...week, [d]: e.target.value })} style={{ flex: 1, minWidth: 0 }}>
            <option value={REST}>Отдых</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>)}
      </>}
    <div className="small" style={{ fontWeight: 600, marginTop: 10 }}>Комментарий</div>
    <TextArea value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)} aria-label="Комментарий" />
    <div className="dim small" style={{ margin: '8px 0' }}>Клиент сам решит, применять ли программу, и сможет вернуть всё как было.</div>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" disabled={busy || empty} onClick={send}>Отправить</Button>
      <Button onClick={close}>Отмена</Button>
    </div>
  </div>
}
