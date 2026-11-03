import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { exerciseNameText, fmtDate, fmtDur, fmtVol } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { setLabel, setsDone, workoutVolume } from '../lib/history.js'
import { weighInAt } from '../lib/bodyweight.js'
import { enabledMeasurementFields, measurementUnit, measurementValue, toMeasurementDisplay, MEASUREMENT_FIELDS } from '../lib/measurements.js'
import { copyClientRoutine } from '../lib/trainer-plan.js'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button } from '../components/ui.jsx'
import TrainerSendPlan from '../components/TrainerSendPlan.jsx'
import '../admin.css'

// One client: what they logged and what they follow. The document comes straight off their state
// file, so anything shapeless is skipped rather than drawn, as in the admin drill-down. Nothing here
// writes to it: a change is made on a copy in the trainer's own Plan and sent as a plan the client
// applies (lib/trainer-plan.js). Russian-only, like Trainer.jsx.

// getDay() order, shown Monday first.
const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']]
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])

function exTarget(e) {
  if (e.min) return `${e.sets || 1} × ${e.min} мин`
  if (e.sec) return `${e.sets || 0} × ${e.sec} с`
  const reps = e.repsMin && e.repsMax ? `${e.repsMin}–${e.repsMax}` : e.reps || 0
  return `${e.sets || 0} × ${reps}${e.weight ? ` · ${e.weight}` : ''}`
}

const PLAN_STATUS = { pending: 'Ждёт решения клиента', applied: 'Клиент применил', declined: 'Клиент отклонил', undone: 'Клиент применил, затем отменил' }

function PlanStatus({ plan, id, setPlan }) {
  const toast = useUI(s => s.toast)
  if (!plan) return null
  const withdraw = () => confirmSheet({
    title: 'Отозвать программу?',
    message: 'Клиент её больше не увидит.',
    confirmText: 'Отозвать', danger: true,
    onConfirm: () => api('/api/trainer/client/plan/withdraw', { method: 'POST', body: JSON.stringify({ id }) })
      .then(() => { setPlan(null); toast('Программа отозвана') }).catch(e => toast(e.message))
  })
  return <div className="row between" style={{ marginTop: 8, gap: 8 }}>
    <div className="dim small">
      {PLAN_STATUS[plan.status] || plan.status}, {fmtDate((plan.resolvedAt || plan.at).slice(0, 10), true)}
      {plan.routines?.length ? ': ' + plan.routines.join(', ') : ''}
    </div>
    {plan.status === 'pending' && <Button size="sm" onClick={withdraw}>Отозвать</Button>}
  </div>
}

function Workout({ w, unit, nameOf }) {
  const [open, setOpen] = useState(false)
  return <div style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
    <button className="row between" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'start' }} onClick={() => setOpen(x => !x)} aria-expanded={open}>
      <div>
        <div className="small" style={{ fontWeight: 600 }}>{w.name || 'Тренировка'}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · подходов: {setsDone(w)}{w.prs?.length ? ' · рекордов: ' + w.prs.length : ''}</div>
      </div>
      <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), unit)}</span>
    </button>
    {open && <div style={{ marginTop: 8 }}>
      {w.entries.map((e, i) => <div key={e.id + ':' + i} style={{ marginBottom: 6 }}>
        <div className="small">{nameOf(e.id)}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e)).join(' · ') || 'Нет выполненных подходов'}</div>
      </div>)}
      {!!w.note && <div className="dim small" style={{ marginTop: 6 }}>{w.note}</div>}
    </div>}
  </div>
}

export default function TrainerClient() {
  const nav = useNavigate()
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const update = useStore(s => s.update)
  const openSheet = useUI(s => s.openSheet)
  useEffect(() => { api('/api/trainer/client?id=' + encodeURIComponent(id)).then(setD).catch(e => setErr(e.message)) }, [id])

  const header = title => <div className="hdr">
    <button className="iconbtn" data-back="/trainer" onClick={() => nav('/trainer')} aria-label="Назад"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{title}</h1></div>
  </div>

  const customEx = useMemo(() => list(d?.customEx), [d])
  if (err) return <div className="narrow">{header('Клиент')}<div className="adm-empty">Не удалось загрузить: {err}</div></div>
  if (!d) return <div className="narrow">{header('Клиент')}<div className="adm-empty">Загрузка…</div></div>

  const nameOf = exId => customEx.find(c => c.id === exId)?.n || exerciseNameText(exOr(exId))
  const workouts = list(d.workouts).filter(w => Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))
  const bodyweight = list(d.bodyweight).filter(b => typeof b.w === 'number' && b.d)
  const measurements = list(d.measurements).filter(m => m.d)
  const routines = list(d.routines)
  const routineName = rid => routines.find(r => r.id === rid)?.name
  const week = DAYS.map(([k, label]) => [label, [].concat(d.week?.[k] || []).map(routineName).filter(Boolean)]).filter(([, names]) => names.length)
  const fields = enabledMeasurementFields(d)
  const latest = measurements[measurements.length - 1]
  const setPlan = plan => setD(x => ({ ...x, plan }))
  const edit = r => {
    let copy
    update(s => { copy = copyClientRoutine(s, d, r) })
    nav('/plan/r/' + encodeURIComponent(copy))
  }
  const send = () => openSheet(close => <TrainerSendPlan client={d} close={close} onSent={setPlan} />)
  const readings = latest ? fields.map(f => [f, measurementValue(latest, f.key)]).filter(([, v]) => v != null) : []

  return <div className="narrow">
    {header(d.user.name)}
    <div className="adm-lead" style={{ marginBottom: 12 }}>С нами с {d.user.created ? fmtDate(d.user.created.slice(0, 10)) : '–'}</div>

    <div className="card">
      <h2 style={{ margin: 0 }}>Вес тела</h2>
      {bodyweight.length
        ? <>
          {bodyweight.length > 1 && <div className="chart" style={{ marginTop: 8 }}><LineChart points={bodyweight.slice(-60).map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))} h={130} unit={d.unit} /></div>}
          <div className="dim small" style={{ marginTop: 6 }}>Последнее: {bodyweight[bodyweight.length - 1].w} {d.unit}, {fmtDate(bodyweight[bodyweight.length - 1].d, true)}</div>
        </>
        : <div className="adm-empty">Взвешиваний нет.</div>}
    </div>

    <div className="card">
      <h2 style={{ margin: 0 }}>Замеры</h2>
      {readings.length
        ? <>
          <div className="dim small" style={{ margin: '6px 0' }}>На {fmtDate(latest.d, true)}</div>
          {readings.map(([f, v]) => <div key={f.key} className="row between small" style={{ padding: '4px 0' }}>
            <span>{MEASUREMENT_FIELDS.includes(f) ? t(f.label) : f.label}</span>
            <span>{toMeasurementDisplay(v, d.unit, f)} {measurementUnit(d.unit, f) === 'none' ? '' : measurementUnit(d.unit, f)}</span>
          </div>)}
        </>
        : <div className="adm-empty">Замеров нет.</div>}
    </div>

    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Программы</h2>
        <Button variant="primary" size="sm" icon="plus" onClick={send}>Отправить</Button></div>
      <PlanStatus plan={d.plan} id={d.user.id} setPlan={setPlan} />
      {week.length > 0 && <div className="dim small" style={{ marginTop: 6 }}>{week.map(([day, names]) => day + ': ' + names.join(', ')).join(' · ')}</div>}
      {routines.length
        ? routines.map(r => <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--sep)' }}>
          <div className="row between" style={{ gap: 8 }}>
            <div className="small" style={{ fontWeight: 600 }}>{r.emoji ? r.emoji + ' ' : ''}{r.name || 'Без названия'}</div>
            <Button size="sm" onClick={() => edit(r)}>Изменить</Button>
          </div>
          {list(r.ex).map((e, i) => <div key={e.id + ':' + i} className="row between dim" style={{ fontSize: '.75rem', padding: '2px 0' }}>
            <span>{nameOf(e.id)}</span><span>{exTarget(e)}</span>
          </div>)}
        </div>)
        : <div className="adm-empty">Программ нет.</div>}
    </div>

    <div className="card">
      <h2 style={{ margin: 0 }}>Тренировки</h2>
      {workouts.length
        ? workouts.slice(0, 60).map(w => <Workout key={w.id} w={w} unit={d.unit} nameOf={nameOf} />)
        : <div className="adm-empty">Тренировок нет.</div>}
    </div>
  </div>
}
