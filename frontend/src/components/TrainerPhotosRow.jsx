import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'
import { Section, Row, Switch } from './ui.jsx'

// A client's choice to open their progress photos to their trainer. Off until they turn it on;
// absent for someone without a trainer. Russian-only, like views/Trainer.jsx.
export default function TrainerPhotosRow() {
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  useEffect(() => {
    let gone = false
    api('/api/account/trainer').then(x => { if (!gone) setD(x) }).catch(() => {})
    return () => { gone = true }
  }, [])
  if (!d?.trainer) return null
  const flip = on => api('/api/account/trainer/photos', { method: 'POST', body: JSON.stringify({ on }) })
    .then(r => setD(x => ({ ...x, photosShared: r.photosShared })))
    .catch(e => toast(e.message))
  return <Section>
    <Row icon="person" iconTint="var(--indigo)" title="Показывать фото тренеру"
      subtitle="Тренер увидит фото с этого экрана, но не видео. Доступ можно закрыть в любой момент.">
      <Switch aria-label="Показывать фото тренеру" checked={!!d.photosShared} onChange={flip} />
    </Row>
  </Section>
}
