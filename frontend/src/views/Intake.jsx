import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { EXTENDED_STEPS, SHORT_STEPS, isShown, missing, stepAnswers } from '../lib/intake-questions.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { isOn } from '../lib/modules.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import IntakeAnswers from '../components/IntakeAnswers.jsx'
import { printIntake } from '../lib/intake-print.js'
import TrainerPhotosRow from '../components/TrainerPhotosRow.jsx'
import { Button, TextArea, TextField } from '../components/ui.jsx'

// The questionnaire for a trainer's client: consent first, then a step per screen, each saved as
// it is left, so closing the app loses one screen at most. `?part=extended` is the longer part the
// trainer asks for. With the short part done, the plain address is the client's own summary:
// read, change, delete. Russian-only, like Trainer.jsx.
function Question({ q, value, onChange }) {
  return <div style={{ marginTop: 16 }}>
    <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{q.label}</div>
    {q.type === 'choice' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {q.options.map(([v, label]) => <Button key={v} size="sm" variant={value === v ? 'primary' : 'plain'} style={value === v ? undefined : { boxShadow: 'inset 0 0 0 1px var(--sep)' }} aria-pressed={value === v} onClick={() => onChange(value === v ? '' : v)}>{label}</Button>)}
    </div>}
    {q.type === 'number' && <TextField inputMode="decimal" aria-label={q.label} maxLength={6} value={value || ''} onChange={e => onChange(e.target.value.replace(/[^\d.,]/g, ''))} />}
    {q.type === 'text' && <TextArea aria-label={q.label} rows={3} maxLength={2000} value={value || ''} onChange={e => onChange(e.target.value)} />}
    {q.hint && <div className="dim" style={{ fontSize: '.72rem', marginTop: 4 }}>{q.hint}</div>}
  </div>
}

export default function Intake() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const toast = useUI(s => s.toast)
  const canPhotos = useStore(s => isOn(s.S, 'body'))
  const user = useStore(s => s.user)
  const extended = params.get('part') === 'extended'
  const steps = extended ? EXTENDED_STEPS : SHORT_STEPS
  const [d, setD] = useState(null)
  const [answers, setAnswers] = useState({})
  const [step, setStep] = useState(0)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [consented, setConsented] = useState(false)
  const load = () => api('/api/account/intake').then(x => {
    if (!x?.trainer) { nav('/home', { replace: true }); return }
    setD(x)
    setAnswers(x.intake?.answers || {})
  }).catch(e => toast(e.message))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => nav('/home')
  const header = title => <div className="hdr">
    <button className="iconbtn" data-back="/home" onClick={leave} aria-label="Назад"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{title}</h1></div>
  </div>
  if (!d) return <div className="narrow">{header('Анкета')}<div className="adm-empty">Загрузка…</div></div>

  const intake = d.intake
  if (!intake && !consented) return <div className="narrow">
    {header('Анкета для тренера')}
    <div className="card">
      <p style={{ marginTop: 0 }}>Анкета поможет вашему тренеру составить программу. В ней есть вопросы о здоровье.</p>
      <ul className="small" style={{ paddingInlineStart: 18, marginBottom: 16 }}>
        <li>Ответы в приложении видит только {d.trainer.name}.</li>
        <li>Они хранятся на сервере приложения. Администратор сервера технически имеет к нему доступ, и ответы попадают в резервные копии на время их хранения.</li>
        <li>Вы можете изменить или удалить ответы в настройках. Если вы отвяжетесь от тренера, они удалятся.</li>
      </ul>
      <Button variant="primary" onClick={() => setConsented(true)}>Согласиться и продолжить</Button>
      <Button style={{ marginTop: 8 }} onClick={leave}>Не сейчас</Button>
    </div>
  </div>

  if (!extended && intake?.shortDoneAt && !editing) {
    const remove = () => confirmSheet({
      title: 'Удалить анкету?',
      message: 'Ответы удалятся, тренер их больше не увидит. Вернуть их будет нельзя.',
      confirmText: 'Удалить', danger: true,
      onConfirm: () => api('/api/account/intake/delete', { method: 'POST', body: '{}' })
        .then(() => { toast('Анкета удалена'); leave() }).catch(e => toast(e.message)),
    })
    return <div className="narrow">
      {header('Моя анкета')}
      <div className="card"><IntakeAnswers answers={intake.answers} /></div>
      <Button variant="primary" onClick={() => { setStep(0); setEditing(true) }}>Изменить ответы</Button>
      <Button style={{ marginTop: 8 }} icon="download" onClick={() => printIntake(intake, user?.name)}>Сохранить в PDF</Button>
      {intake.extendedRequestedAt && <Button style={{ marginTop: 8 }} onClick={() => { setStep(0); nav('/intake?part=extended') }}>Расширенная анкета</Button>}
      <Button style={{ marginTop: 8 }} onClick={remove}>Удалить анкету</Button>
    </div>
  }

  const current = steps[step]
  const last = step === steps.length - 1
  const blocked = missing(current, answers).length > 0
  const put = (id, v) => setAnswers(a => ({ ...a, [id]: v }))
  const next = async to => {
    setBusy(true)
    try {
      const r = await api('/api/account/intake', { method: 'POST', body: JSON.stringify({
        answers: stepAnswers(current, answers),
        ...(intake ? {} : { consent: true }),
        ...(last ? { done: extended ? 'extended' : 'short' } : {}),
      }) })
      setD(x => ({ ...x, intake: r.intake }))
      if (last) { toast('Анкета сохранена'); nav(to || '/home') } else { setStep(step + 1); window.scrollTo?.(0, 0) }
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return <div className="narrow">
    {header(extended ? 'Расширенная анкета' : 'Анкета для тренера')}
    <div className="dim small">Шаг {step + 1} из {steps.length}</div>
    <div className="card" style={{ marginTop: 8 }}>
      <h2 style={{ margin: 0 }}>{current.title}</h2>
      {current.photos && <>
        <p className="small">Фото помогут тренеру оценить текущую форму и расставить акценты в программе. Лучше снять себя в полный рост спереди, сбоку и сзади при хорошем свете.</p>
        <TrainerPhotosRow />
        {canPhotos && <Button onClick={() => next('/progress-photos')} disabled={busy}>Сохранить и добавить фото</Button>}
      </>}
      {current.questions.filter(q => isShown(q, answers)).map(q => <Question key={q.id} q={q} value={answers[q.id]} onChange={v => put(q.id, v)} />)}
    </div>
    <div className="row between" style={{ gap: 8 }}>
      {step > 0 ? <Button onClick={() => setStep(step - 1)}>Назад</Button> : <Button onClick={leave}>Заполнить позже</Button>}
      <Button variant="primary" disabled={blocked || busy} onClick={() => next()}>{last ? 'Готово' : 'Далее'}</Button>
    </div>
  </div>
}
