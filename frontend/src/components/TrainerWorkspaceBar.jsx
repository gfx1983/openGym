import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { leaveWorkspace, useWorkspace } from '../store/useWorkspace.js'
import { api } from '../lib/api.js'
import { addFromMyPlan, buildTrainerPlan, diffWorkspace, isEmptyDiff, summarize } from '../lib/trainer-plan.js'
import { programmesOf } from '../lib/programmes.js'
import { confirmSheet } from '../sheets.jsx'
import { Button, TextArea } from './ui.jsx'

// Over every screen while a trainer works on a client's plan: whose plan this is, and the ways out.
// Russian-only, like views/Trainer.jsx.

function SendSheet({ client, base, close, onSent }) {
  const toast = useUI(s => s.toast)
  const draft = useStore(s => s.S)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const diff = diffWorkspace(base, draft)
  const send = async () => {
    setBusy(true)
    try {
      await api('/api/trainer/client/plan', { method: 'POST', body: JSON.stringify(buildTrainerPlan(base, draft, client.user.id, note)) })
      close()
      onSent()
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return <>
    <h3>Отправить: {client.user.name}</h3>
    {summarize(base, draft, diff).map((line, i) => <div key={i} className="small" style={{ padding: '3px 0' }}>{line}</div>)}
    {diff.rotationChanged && <div className="dim small" style={{ marginTop: 6 }}>Ротация не отправляется: это настройка самого клиента.</div>}
    <div className="small" style={{ fontWeight: 600, margin: '12px 0 4px' }}>Комментарий</div>
    <TextArea value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)} aria-label="Комментарий" />
    <div className="dim small" style={{ margin: '8px 0' }}>Изменения применятся сами, когда клиент откроет приложение. Если у него включены уведомления, он получит сообщение.</div>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" disabled={busy} onClick={send}>Отправить</Button>
      <Button onClick={close}>Отмена</Button>
    </div>
  </>
}

function MyPlanSheet({ real, close }) {
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const add = (what, name) => {
    update(s => addFromMyPlan(s, real, what))
    toast('Добавлено в план клиента: ' + name)
    close()
  }
  const routines = real.routines || [], programmes = programmesOf(real)
  return <>
    <h3>Из моего плана</h3>
    {!routines.length && !programmes.length && <div className="adm-empty">В вашем плане пока ничего нет.</div>}
    <div className="list">
      {routines.map(r => <button key={r.id} type="button" className="item" style={{ width: '100%', textAlign: 'start' }} onClick={() => add({ routineId: r.id }, r.name)}>
        <div className="grow"><div className="tt">{r.emoji ? r.emoji + ' ' : ''}{r.name}</div></div>
      </button>)}
      {programmes.map(p => <button key={p.id} type="button" className="item" style={{ width: '100%', textAlign: 'start' }} onClick={() => add({ programmeId: p.id }, p.name)}>
        <div className="grow"><div className="tt">{p.name}</div><div className="ss">Цикл, недель: {p.weeks.length}</div></div>
      </button>)}
    </div>
  </>
}

export default function TrainerWorkspaceBar() {
  const nav = useNavigate()
  const { client, base, real } = useWorkspace()
  const sandbox = useStore(s => s.tourSandbox)
  const draft = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const shown = !!client && sandbox
  // The bar sits over every screen, so the screens start below it.
  useEffect(() => {
    if (!shown) return
    document.body.style.paddingTop = '56px'
    return () => { document.body.style.paddingTop = '' }
  }, [shown])
  if (!shown) return null
  const home = '/trainer/client/' + encodeURIComponent(client.user.id)
  const empty = isEmptyDiff(diffWorkspace(base, draft))
  const out = () => { leaveWorkspace(); nav(home) }
  const leave = () => (empty ? out() : confirmSheet({
    title: 'Выйти без отправки?',
    message: 'Изменения в плане клиента пропадут. Ваш собственный план они не затрагивают.',
    confirmText: 'Выйти', danger: true, onConfirm: out,
  }))
  const send = () => openSheet(close => <SendSheet client={client} base={base} close={close} onSent={() => { toast('Отправлено'); out() }} />)
  return <div role="region" aria-label="План клиента" style={{
    position: 'fixed', insetInline: 0, top: 0, zIndex: 40, padding: 'calc(env(safe-area-inset-top) + 8px) 16px 8px',
    background: 'var(--surface-2)', borderBottom: '2px solid var(--indigo)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
  }}>
    <div className="small" style={{ flex: '1 1 140px', minWidth: 0, fontWeight: 600 }}>План клиента: {client.user.name}</div>
    <Button size="sm" onClick={() => openSheet(close => <MyPlanSheet real={real} close={close} />)}>Из моего плана</Button>
    <Button size="sm" onClick={leave}>Выйти</Button>
    <Button size="sm" variant="primary" disabled={empty} onClick={send}>Отправить</Button>
  </div>
}
