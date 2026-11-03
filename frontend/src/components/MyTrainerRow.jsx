import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { confirmSheet } from '../sheets.jsx'
import { Row } from './ui.jsx'

// Shown to a client: who can see their training, and the way out of it. Absent for everyone else.
// Russian-only, like views/Trainer.jsx.
//
// Closing the confirm sheet can remount this row, and the new one's request then races the unlink,
// so whichever row is on screen is told to ask again once the unlink has landed.
const changed = new EventTarget()

export default function MyTrainerRow() {
  const toast = useUI(s => s.toast)
  const [trainer, setTrainer] = useState(null)
  useEffect(() => {
    const load = () => api('/api/account/trainer').then(d => setTrainer(d.trainer)).catch(() => {})
    load()
    changed.addEventListener('change', load)
    return () => changed.removeEventListener('change', load)
  }, [])
  if (!trainer) return null
  const unlink = () => confirmSheet({
    title: 'Отвязаться от тренера?',
    message: trainer.name + ' больше не увидит ваши тренировки, вес, замеры и программы. Ваши данные останутся у вас. Вернуться можно только по новому коду.',
    confirmText: 'Отвязаться', danger: true,
    onConfirm: () => api('/api/account/trainer/unlink', { method: 'POST', body: '{}' })
      .then(() => { changed.dispatchEvent(new Event('change')); toast('Вы отвязались от тренера') })
      .catch(e => toast(e.message)),
  })
  return <Row icon="person" iconTint="var(--indigo)" title={'Мой тренер: ' + trainer.name}
    subtitle="Видит ваши тренировки, вес, замеры и программы. Нажмите, чтобы отвязаться." onClick={unlink} />
}
