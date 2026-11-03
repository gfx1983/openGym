import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { exerciseNameText, fmtDate, fmtDur, fmtVol } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { setLabel, setsDone, workoutVolume } from '../lib/history.js'
import { weighInAt } from '../lib/bodyweight.js'
import { enabledMeasurementFields, measurementUnit, measurementValue, toMeasurementDisplay, MEASUREMENT_FIELDS } from '../lib/measurements.js'
import { t } from '../lib/i18n.js'
import { enterWorkspace } from '../store/useWorkspace.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button } from '../components/ui.jsx'
import '../admin.css'

// One client: what they logged and what they follow. The document comes straight off their state
// file, so anything shapeless is skipped rather than drawn, as in the admin drill-down. Nothing here
// writes to it: the plan is edited on a copy (store/useWorkspace.js) and what changed is sent to the
// client's app (lib/trainer-plan.js). Russian-only, like Trainer.jsx.

// getDay() order, shown Monday first.
const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']]
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])

function exTarget(e) {
  if (e.min) return `${e.sets || 1} × ${e.min} мин`
  if (e.sec) return `${e.sets || 0} × ${e.sec} с`
  const reps = e.repsMin && e.repsMax ? `${e.repsMin}–${e.repsMax}` : e.reps || 0
  return `${e.sets || 0} × ${reps}${e.weight ? ` · ${e.weight}` : ''}`
}

const PLAN_STATUS = { pending: 'Отправлено, клиент ещё не открывал приложение', applied: 'Установлено у клиента', undone: 'Клиент вернул как было' }

function PlanStatus({ plan, id, setPlan }) {
  const toast = useUI(s => s.toast)
  if (!plan) return null
  const withdraw = () => confirmSheet({
    title: 'Отозвать изменения?',
    message: 'Клиент их не получит.',
    confirmText: 'Отозвать', danger: true,
    onConfirm: () => api('/api/trainer/client/plan/withdraw', { method: 'POST', body: JSON.stringify({ id }) })
      .then(() => { setPlan(null); toast('Изменения отозваны') }).catch(e => toast(e.message))
  })
  return <div className="row between" style={{ marginTop: 8, gap: 8 }}>
    <div className="dim small">
      {PLAN_STATUS[plan.status] || plan.status}, {fmtDate((plan.resolvedAt || plan.at).slice(0, 10), true)}
      {plan.summary?.length ? ': ' + plan.summary.join('; ') : ''}
    </div>
    {plan.status === 'pending' && <Button size="sm" onClick={withdraw}>Отозвать</Button>}
  </div>
}

// What the client actually lifts now: their last session of it, else their confirmed working weight.
function liftedNow(d, workouts, exId) {
  for (const w of workouts) {
    const sets = (w.entries.find(e => e.id === exId)?.sets || []).filter(s => s.done && s.w > 0)
    if (sets.length) return { w: Math.max(...sets.map(s => s.w)), d: w.d }
  }
  const kept = d.exWeights?.[exId]
  return kept?.w > 0 ? { w: kept.w, d: kept.d } : null
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
  const toast = useUI(s => s.toast)
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
  // Read again on the way in: the plan and the weights as the client has them now.
  const editPlan = () => api('/api/trainer/client?id=' + encodeURIComponent(id)).then(fresh => {
    if (enterWorkspace(fresh)) nav('/plan')
  }).catch(e => toast(e.message))
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
        <Button variant="primary" size="sm" onClick={editPlan}>Редактировать план</Button></div>
      <PlanStatus plan={d.plan} id={d.user.id} setPlan={setPlan} />
      {week.length > 0 && <div className="dim small" style={{ marginTop: 6 }}>{week.map(([day, names]) => day + ': ' + names.join(', ')).join(' · ')}</div>}
      {routines.length
        ? routines.map(r => <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--sep)' }}>
          <div className="small" style={{ fontWeight: 600 }}>{r.emoji ? r.emoji + ' ' : ''}{r.name || 'Без названия'}</div>
          {list(r.ex).map((e, i) => {
            const now = liftedNow(d, workouts, e.id)
            return <div key={e.id + ':' + i} style={{ padding: '2px 0' }}>
              <div className="row between dim" style={{ fontSize: '.75rem' }}><span>{nameOf(e.id)}</span><span>{exTarget(e)}</span></div>
              {now && <div className="dim" style={{ fontSize: '.7rem', textAlign: 'end' }}>Поднимает: {now.w} {d.unit}{now.d ? ', ' + fmtDate(now.d, true) : ''}</div>}
            </div>
          })}
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
