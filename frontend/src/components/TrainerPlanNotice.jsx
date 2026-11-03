import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { undoAndTell } from '../lib/trainer-plan.js'
import { Button } from './ui.jsx'

// On a client's Home: what the trainer just changed in their plan. It is already in place; this is
// the telling, and the way back. Russian-only, like views/Trainer.jsx.
export default function TrainerPlanNotice() {
  const undo = useStore(s => s.S.trainerUndo)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  if (!undo || undo.seen) return null
  return <div className="card">
    <h2 style={{ margin: 0 }}>{undo.trainer || 'Тренер'} обновил(а) вашу программу</h2>
    {!!undo.note && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{undo.note}</div>}
    {(undo.summary || []).map((line, i) => <div key={i} className="dim small" style={{ marginTop: 4 }}>{line}</div>)}
    {undo.scheduleSkipped && <div className="dim small" style={{ marginTop: 6 }}>Расписание недели не изменилось: сейчас идёт цикл или ротация.</div>}
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <Button variant="primary" size="sm" onClick={() => update(s => { s.trainerUndo.seen = true })}>Понятно</Button>
      <Button size="sm" onClick={() => { undoAndTell(update, undo); toast('Вернули как было') }}>Вернуть как было</Button>
    </div>
  </div>
}
