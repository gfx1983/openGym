// The questionnaire a trainer's client fills in, and the only place its questions are written: the
// form (views/Intake.jsx) and the trainer's card (views/TrainerClient.jsx) both read from here. The
// server stores answers by id and knows no question. An id is kept once clients have answered it,
// or their old answer stops showing. Russian-only, like views/Trainer.jsx.
//
// A step is one screen. `required` holds the short part's Next until it is answered; `when` shows
// a question only after a given answer to another one. A step with `photos` asks for no answers:
// it opens the progress photos to the trainer.
const YES_NO = [['no', 'Нет'], ['yes', 'Да']]

export const SHORT_STEPS = [
  { title: 'О вас', questions: [
    { id: 'sex', label: 'Пол', type: 'choice', required: true, options: [['male', 'Мужской'], ['female', 'Женский']] },
    { id: 'age', label: 'Возраст, лет', type: 'number', required: true },
    { id: 'height', label: 'Рост, см', type: 'number', required: true },
    { id: 'weight', label: 'Вес, кг', type: 'number', required: true },
  ] },
  { title: 'Цель', questions: [
    { id: 'goal', label: 'Главная цель', type: 'choice', required: true, options: [['fatloss', 'Снизить вес'], ['muscle', 'Набрать мышцы'], ['strength', 'Стать сильнее'], ['health', 'Форма и здоровье'], ['other', 'Другое']] },
    { id: 'goal_term', label: 'За какой срок хотите результат?', type: 'choice', options: [['3m', 'До 3 месяцев'], ['6m', '3–6 месяцев'], ['12m', '6–12 месяцев'], ['none', 'Без срока']] },
    { id: 'goal_details', label: 'Чего хотите добиться? Опишите своими словами', type: 'text' },
  ] },
  { title: 'Тренировки', questions: [
    { id: 'days', label: 'Сколько раз в неделю готовы тренироваться?', type: 'choice', required: true, options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6+']] },
    { id: 'minutes', label: 'Сколько времени на одну тренировку?', type: 'choice', required: true, options: [['30', 'До 30 мин'], ['45', '45 мин'], ['60', '60 мин'], ['90', '90 мин']] },
    { id: 'place', label: 'Где будете заниматься?', type: 'choice', required: true, options: [['gym', 'В зале'], ['home', 'Дома'], ['both', 'И там, и там']] },
    { id: 'equipment', label: 'Какое оборудование доступно?', type: 'text', hint: 'Можно написать название зала или ссылку на него.' },
  ] },
  { title: 'Опыт', questions: [
    { id: 'experience', label: 'Как давно занимаетесь спортом?', type: 'choice', required: true, options: [['none', 'Не занимаюсь'], ['6m', 'До 6 месяцев'], ['2y', '6 месяцев – 2 года'], ['more', 'Больше 2 лет']] },
    { id: 'regular', label: 'Тренировались регулярно последний год?', type: 'choice', options: [['yes', 'Да'], ['breaks', 'С перерывами'], ['no', 'Нет']] },
    { id: 'sports', label: 'Какие тренировки нравились, а какие нет?', type: 'text' },
  ] },
  { title: 'Здоровье', questions: [
    { id: 'limits', label: 'Что-нибудь болит сейчас или врач запретил какие-то нагрузки?', type: 'choice', required: true, options: YES_NO },
    { id: 'limits_details', label: 'Что именно?', type: 'text', when: ['limits', 'yes'] },
    { id: 'conditions', label: 'Были травмы или есть заболевания сердца, сосудов, суставов, спины?', type: 'choice', required: true, options: YES_NO },
    { id: 'conditions_details', label: 'Какие? Укажите и наследственные, если знаете', type: 'text', when: ['conditions', 'yes'] },
    { id: 'meds', label: 'Принимаете лекарства постоянно?', type: 'choice', required: true, options: YES_NO },
    { id: 'meds_details', label: 'Какие?', type: 'text', when: ['meds', 'yes'] },
    { id: 'pregnancy', label: 'Беременность или роды за последний год?', type: 'choice', when: ['sex', 'female'], options: YES_NO },
  ] },
  { title: 'Образ жизни', questions: [
    { id: 'activity', label: 'Сколько двигаетесь в течение дня?', type: 'choice', required: true, options: [['low', 'Мало, сидячая работа'], ['mid', 'Средне, есть прогулки'], ['high', 'Много, работа в движении']] },
    { id: 'watch', label: 'Есть фитнес-часы?', type: 'choice', options: YES_NO },
    { id: 'sleep', label: 'Сколько обычно спите?', type: 'choice', required: true, options: [['5', 'Меньше 6 ч'], ['6', '6–7 ч'], ['7', '7–8 ч'], ['8', 'Больше 8 ч']] },
    { id: 'sleep_problems', label: 'Есть проблемы со сном?', type: 'choice', options: YES_NO },
    { id: 'stress', label: 'Уровень стресса на работе и дома', type: 'choice', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], hint: '1 — почти нет, 5 — очень высокий.' },
    { id: 'stress_appetite', label: 'Как стресс влияет на аппетит?', type: 'choice', options: [['up', 'Повышается'], ['down', 'Пропадает'], ['same', 'Не меняется']] },
  ] },
  { title: 'Питание', questions: [
    { id: 'meals', label: 'Сколько приёмов пищи в день вам удобно?', type: 'choice', options: [['2', '1–2'], ['3', '3'], ['4', '4'], ['5', '5+']] },
    { id: 'food_limits', label: 'Какие продукты не едите? Есть аллергии?', type: 'text' },
    { id: 'comment', label: 'Хотите что-нибудь добавить?', type: 'text' },
  ] },
]

export const EXTENDED_STEPS = [
  { title: 'История веса', questions: [
    { id: 'weight_min', label: 'Минимальный вес во взрослом возрасте, кг', type: 'number' },
    { id: 'weight_max', label: 'Максимальный вес во взрослом возрасте, кг', type: 'number' },
    { id: 'figure_change', label: 'Как менялась фигура за последние 3–5 лет?', type: 'text' },
    { id: 'weight_loss', label: 'Пробовали худеть? Как и чем это закончилось?', type: 'text' },
  ] },
  { title: 'Питание подробнее', questions: [
    { id: 'diet_day', label: 'Опишите обычный день питания', type: 'text', hint: 'Что и примерно сколько едите и пьёте, включая неидеальные моменты.' },
    { id: 'snacks', label: 'Можно перекусывать на работе?', type: 'choice', options: YES_NO },
    { id: 'water', label: 'Сколько воды пьёте в день?', type: 'choice', options: [['1', 'До 1 л'], ['2', '1–2 л'], ['3', 'Больше 2 л'], ['unknown', 'Не знаю']] },
  ] },
  { title: 'Привычки', questions: [
    { id: 'alcohol', label: 'Как часто пьёте алкоголь?', type: 'choice', options: [['never', 'Не пью'], ['rare', 'Редко'], ['weekly', 'Каждую неделю'], ['often', 'Чаще']] },
    { id: 'smoking', label: 'Курите?', type: 'choice', options: YES_NO },
    { id: 'supplements', label: 'Какие БАДы и спортивные добавки принимаете или пробовали?', type: 'text' },
    { id: 'tests', label: 'Есть результаты анализов?', type: 'choice', options: [['fresh', 'Есть свежие'], ['old', 'Только старые'], ['no', 'Нет']], hint: 'Сами результаты передайте тренеру лично.' },
  ] },
  { title: 'Восстановление и общение', questions: [
    { id: 'weekends', label: 'Какие выходные вам ближе?', type: 'choice', options: [['active', 'Активные'], ['passive', 'Спокойные'], ['mixed', 'По-разному']] },
    { id: 'recovery', label: 'Как быстро восстанавливаетесь после нагрузок?', type: 'choice', options: [['fast', 'За день'], ['mid', 'За 2–3 дня'], ['slow', 'Дольше']] },
    { id: 'soreness', label: 'Бывают длительные боли в мышцах?', type: 'choice', options: YES_NO },
    { id: 'barriers', label: 'Что мешало заниматься или держать результат раньше?', type: 'text' },
    { id: 'contact', label: 'Как и как часто вам удобно общаться с тренером?', type: 'text' },
  ] },
  { title: 'Фото', photos: true, questions: [] },
]

export const isShown = (q, answers) => !q.when || answers[q.when[0]] === q.when[1]
export const missing = (step, answers) => step.questions.filter(q => q.required && isShown(q, answers) && !answers[q.id])

// An answer to a question no longer shown is blanked, so the server drops it with the rest. That
// goes for other steps too: the sex is asked on the first, the question that depends on it later.
export function stepAnswers(step, answers) {
  const out = {}
  for (const q of [...SHORT_STEPS, ...EXTENDED_STEPS].flatMap(x => x.questions)) if (answers[q.id] && !isShown(q, answers)) out[q.id] = ''
  for (const q of step.questions) out[q.id] = isShown(q, answers) ? String(answers[q.id] ?? '').trim() : ''
  return out
}

function answerText(q, value) {
  if (q.type !== 'choice') return value
  return q.options.find(([v]) => v === value)?.[1] ?? value
}

/** [{ title, rows: [{ label, value }] }], only what has been answered. */
export function answeredSections(steps, answers) {
  return steps.map(step => ({
    title: step.title,
    rows: step.questions.filter(q => answers?.[q.id] && isShown(q, answers)).map(q => ({ label: q.label, value: answerText(q, answers[q.id]) })),
  })).filter(s => s.rows.length)
}
