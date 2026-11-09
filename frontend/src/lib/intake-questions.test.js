import { describe, expect, it } from 'vitest'
import { EXTENDED_STEPS, SHORT_STEPS, answeredSections, isShown, missing, stepAnswers } from './intake-questions.js'

const all = [...SHORT_STEPS, ...EXTENDED_STEPS].flatMap(s => s.questions)
const health = SHORT_STEPS.find(s => s.title === 'Здоровье')

describe('the questionnaire', () => {
  it('has ids the server accepts, each used once, and under its limit of 80', () => {
    expect(new Set(all.map(q => q.id)).size).toBe(all.length)
    expect(all.length).toBeLessThanOrEqual(80)
    for (const q of all) expect(q.id).toMatch(/^[a-z][a-z0-9_]{0,39}$/)
  })
  it('points every condition at a question that exists', () => {
    for (const q of all.filter(x => x.when)) expect(all.some(x => x.id === q.when[0])).toBe(true)
  })
  it('asks for details only after a yes, and blanks them after a no', () => {
    const details = health.questions.find(q => q.id === 'limits_details')
    expect(isShown(details, { limits: 'no' })).toBe(false)
    expect(isShown(details, { limits: 'yes' })).toBe(true)
    expect(stepAnswers(health, { limits: 'no', limits_details: 'колено' }).limits_details).toBe('')
    expect(stepAnswers(health, { limits: 'yes', limits_details: ' колено ' }).limits_details).toBe('колено')
  })
  it('asks about pregnancy only a woman, and forgets the answer if the sex is changed', () => {
    const q = health.questions.find(x => x.id === 'pregnancy')
    expect(isShown(q, { sex: 'female' })).toBe(true)
    expect(isShown(q, { sex: 'male' })).toBe(false)
    expect(isShown(q, {})).toBe(false)
    expect(stepAnswers(SHORT_STEPS[0], { sex: 'male', pregnancy: 'yes' }).pregnancy).toBe('')
    expect(answeredSections(SHORT_STEPS, { sex: 'male', pregnancy: 'yes' }).flatMap(x => x.rows).map(r => r.label)).toEqual(['Пол'])
  })
  it('holds Next until the required answers are there', () => {
    expect(missing(health, { limits: 'no' }).map(q => q.id)).toEqual(['conditions', 'meds'])
    expect(missing(health, { limits: 'no', conditions: 'no', meds: 'no' })).toEqual([])
  })
  it('reads an answer as its label, and leaves out what was not answered', () => {
    const [section] = answeredSections(SHORT_STEPS, { sex: 'female', age: '30' })
    expect(section.rows).toEqual([{ label: 'Пол', value: 'Женский' }, { label: 'Возраст, лет', value: '30' }])
    expect(answeredSections(SHORT_STEPS, {})).toEqual([])
  })
})
