import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { undoAndTell } from '../lib/trainer-plan.js'
import { enablePush, pushSupported, syncPushSubscription } from '../lib/push.js'
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
  const undo = useStore(s => s.S.trainerUndo)
  const update = useStore(s => s.update)
  const [pushOn, setPushOn] = useState(null)
  useEffect(() => {
    const load = () => api('/api/account/trainer').then(d => setTrainer(d.trainer)).catch(() => {})
    load()
    if (pushSupported()) syncPushSubscription().then(setPushOn).catch(() => {})
    changed.addEventListener('change', load)
    return () => changed.removeEventListener('change', load)
  }, [])
  // Undo stays after leaving the trainer: the plan they sent is still in the profile.
  const undoRow = undo && <Row icon="undo" iconTint="var(--indigo)" title="Вернуть программы как было"
    subtitle={'До изменений от ' + (undo.trainer || 'тренера') + '. Ваши правки после них тоже пропадут.'}
    onClick={() => confirmSheet({
      title: 'Вернуть как было?',
      message: 'Программы и расписание станут такими, как до применения. Тренировки останутся.',
      confirmText: 'Вернуть',
      onConfirm: () => { undoAndTell(update, undo); toast('Вернули как было') },
    })} />
  if (!trainer) return undoRow || null
  const unlink = () => confirmSheet({
    title: 'Отвязаться от тренера?',
    message: trainer.name + ' больше не увидит ваши тренировки, вес, замеры и программы и не сможет менять ваш план. Ваши данные останутся у вас. Вернуться можно только по новому коду.',
    confirmText: 'Отвязаться', danger: true,
    onConfirm: () => api('/api/account/trainer/unlink', { method: 'POST', body: '{}' })
      .then(() => { changed.dispatchEvent(new Event('change')); toast('Вы отвязались от тренера') })
      .catch(e => toast(e.message)),
  })
  return <>
    <Row icon="person" iconTint="var(--indigo)" title={'Мой тренер: ' + trainer.name}
      subtitle="Видит ваши тренировки, вес, замеры и программы и может менять ваш план. Нажмите, чтобы отвязаться." onClick={unlink} />
    {pushOn === false && <Row icon="bell" iconTint="var(--indigo)" title="Уведомлять о новых программах"
      subtitle="Сообщение на телефон, когда тренер изменит ваш план."
      onClick={() => enablePush().then(() => { setPushOn(true); toast('Уведомления включены') }).catch(e => toast(e.message))} />}
    {!pushSupported() && <Row icon="bell" iconTint="var(--indigo)" title="Уведомления о новых программах"
      subtitle="На iPhone работают только в приложении, добавленном на экран «Домой»." />}
    {undoRow}
  </>
}
