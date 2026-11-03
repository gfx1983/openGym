import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { exerciseNameText } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { applyTrainerPlan, describeTrainerPlan, undoAndTell } from '../lib/trainer-plan.js'
import { Button } from './ui.jsx'

// On a client's Home: what the trainer sent, and the client's decision. Nothing changes until they
// press Apply. Russian-only, like views/Trainer.jsx.

const resolve = (id, decision) => api('/api/account/trainer/plan/resolve', { method: 'POST', body: JSON.stringify({ id, decision }) })
  // Withdrawn or settled on another device meanwhile: there is nothing left to tell the server.
  .catch(e => { if (e.code !== 'stale') throw e })

function exLine(e) {
  const reps = e.repsMin && e.repsMax ? `${e.repsMin}–${e.repsMax}` : e.reps
  if (e.min) return `${e.sets || 1} × ${e.min} мин`
  if (e.sec) return `${e.sets || 0} × ${e.sec} с`
  return `${e.sets || 0} × ${reps || 0}${e.weight ? ' · ' + e.weight : ''}`
}

export default function TrainerPlanCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [got, setGot] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('/api/account/trainer').then(setGot).catch(() => {}) }, [])
  const plan = got?.plan
  const about = useMemo(() => {
    if (!plan) return null
    // A plan this version cannot read is not worth taking Home down for.
    try { return describeTrainerPlan(S, plan, got.trainer.id) } catch { return null }
  }, [plan, got, S])

  if (done) return <div className="card">
    <div className="small" style={{ fontWeight: 600 }}>Программа от тренера применена</div>
    {done.scheduleSkipped && <div className="dim small" style={{ marginTop: 4 }}>Расписание недели не менялось: сейчас идёт цикл или ротация.</div>}
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <Button size="sm" onClick={() => setDone(null)}>Понятно</Button>
      <Button size="sm" onClick={() => { undoAndTell(update, useStore.getState().S.trainerUndo); setDone(null); toast('Вернули как было') }}>Вернуть как было</Button>
    </div>
  </div>
  if (!plan || !about) return null

  const nameOf = id => about.customEx.find(c => c.id === id)?.n || exerciseNameText(exOr(id))
  const apply = async () => {
    setBusy(true)
    try {
      let res
      update(s => { res = applyTrainerPlan(s, plan, got.trainer.id, got.trainer.name) })
      await resolve(plan.id, 'applied')
      setGot({ ...got, plan: null })
      setDone(res)
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  const decline = async () => {
    setBusy(true)
    try { await resolve(plan.id, 'declined'); setGot({ ...got, plan: null }); toast('Программа отклонена') }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return <div className="card">
    <h2 style={{ margin: 0 }}>{got.trainer.name} прислал(а) программу</h2>
    {!!plan.note && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{plan.note}</div>}
    {about.routines.map((r, i) => <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--sep)' }}>
      <div className="small" style={{ fontWeight: 600 }}>{r.name}</div>
      <div className="dim" style={{ fontSize: '.72rem' }}>{r.replaces ? 'Заменит вашу «' + r.replaces + '»' : 'Новая'}</div>
      {r.ex.map((e, j) => <div key={j} className="row between dim" style={{ fontSize: '.75rem', padding: '2px 0', gap: 8 }}>
        <span>{nameOf(e.id)}</span><span style={{ whiteSpace: 'nowrap' }}>{exLine(e)}</span>
      </div>)}
    </div>)}
    {about.removed.length > 0 && <div className="dim small" style={{ marginTop: 8 }}>Уберёт: {about.removed.join(', ')}</div>}
    {about.schedule && <div className="dim small" style={{ marginTop: 8 }}>Заменит ваше расписание на неделю.</div>}
    {about.scheduleSkipped && <div className="dim small" style={{ marginTop: 8 }}>Расписание недели не изменится: сейчас идёт цикл или ротация.</div>}
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button variant="primary" size="sm" disabled={busy} onClick={apply}>Применить</Button>
      <Button size="sm" disabled={busy} onClick={decline}>Отклонить</Button>
    </div>
  </div>
}
