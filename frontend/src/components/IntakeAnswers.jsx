import { answeredSections, EXTENDED_STEPS, SHORT_STEPS } from '../lib/intake-questions.js'

// The answers as text, for the client's own summary and the trainer's card.
export default function IntakeAnswers({ answers }) {
  const sections = answeredSections([...SHORT_STEPS, ...EXTENDED_STEPS], answers)
  return sections.map(s => <div key={s.title} style={{ marginTop: 10 }}>
    <div className="small" style={{ fontWeight: 600 }}>{s.title}</div>
    {s.rows.map(r => <div key={r.label} style={{ padding: '4px 0' }}>
      <div className="dim" style={{ fontSize: '.75rem' }}>{r.label}</div>
      <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.value}</div>
    </div>)}
  </div>)
}
