// The questionnaire on paper: the same answers the trainer's card and the client's summary show
// (lib/intake-questions.js answeredSections), on the shared printout page (lib/print-doc.js). The
// print dialog or the phone's print sheet saves it as a PDF. Russian-only, like views/Trainer.jsx.
import { esc, printShell, printDocument, paperDate } from './print-doc.js'
import { answeredSections, EXTENDED_STEPS, SHORT_STEPS } from './intake-questions.js'

const INTAKE_CSS = `
  .sec { margin-top: 12pt; }
  .qa { padding: 4pt 0; border-bottom: 1px solid var(--rule-soft); }
  .qa-q { font-size: 8pt; color: var(--muted); }
  .qa-a { white-space: pre-wrap; overflow-wrap: anywhere; }
`

const day = iso => iso ? paperDate(String(iso).slice(0, 10)) : ''

/** The page for `intake` (the server's intake view) of the client called `name`. */
export function intakePrintHTML(intake, name) {
  const sections = answeredSections([...SHORT_STEPS, ...EXTENDED_STEPS], intake?.answers || {})
  const row = r => `<div class="qa keep"><div class="qa-q">${esc(r.label)}</div><div class="qa-a">${esc(r.value)}</div></div>`
  // A heading shares its .keep with the first answer under it, so it never ends a page alone.
  const body = sections.length
    ? sections.map(s => `<div class="keep sec"><div class="sec-h">${esc(s.title)}</div>${row(s.rows[0])}</div>` + s.rows.slice(1).map(row).join('')).join('')
    : '<div class="none">Ответов пока нет.</div>'
  const facts = [
    intake?.shortDoneAt ? 'Заполнена ' + day(intake.shortDoneAt) : 'Заполняется',
    intake?.extendedDoneAt ? 'Расширенная часть ' + day(intake.extendedDoneAt) : '',
    intake?.updatedAt ? 'Изменена ' + day(intake.updatedAt) : '',
  ]
  return printShell({ title: 'Анкета: ' + (name || 'клиент'), kicker: 'Анкета для тренера', facts, owner: name, body, css: INTAKE_CSS })
}

/** Opens the print dialog (→ Save as PDF), or the print sheet in the app. */
export function printIntake(intake, name) {
  return printDocument(intakePrintHTML(intake, name), 'Анкета ' + (name || 'клиента'))
}
