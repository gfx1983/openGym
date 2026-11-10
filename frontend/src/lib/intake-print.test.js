// The questionnaire on paper holds what the card shows: the answered questions as text, nothing a
// client never saw, and an answer that cannot turn into markup.
import { describe, expect, it } from 'vitest'
import { intakePrintHTML } from './intake-print.js'

describe('intakePrintHTML', () => {
  it('prints the answers as text under their sections, with the client\'s name', () => {
    const html = intakePrintHTML({ shortDoneAt: '2026-11-09T10:00:00Z', answers: { sex: 'female', age: '34', goal: 'fatloss', pregnancy: 'no' } }, 'Ира')
    expect(html).toContain('<title>Анкета: Ира</title>')
    expect(html).toContain('О вас')
    expect(html).toContain('Женский')
    expect(html).toContain('Снизить вес')
    expect(html).toContain('Беременность или роды за последний год?')
  })

  it('leaves out a question the client was never shown', () => {
    const html = intakePrintHTML({ answers: { sex: 'male', pregnancy: 'yes' } }, 'Богдан')
    expect(html).toContain('Мужской')
    expect(html).not.toContain('Беременность')
    expect(html).toContain('Заполняется')
  })

  it('escapes what the client wrote', () => {
    const html = intakePrintHTML({ shortDoneAt: 'x', answers: { goal_details: '<img src=x onerror=alert(1)>' } }, '<b>Ира</b>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>Ира</b>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('says there is nothing yet for empty answers', () => {
    expect(intakePrintHTML({ answers: {} }, 'Ира')).toContain('Ответов пока нет.')
  })
})
