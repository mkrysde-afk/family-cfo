import { describe, expect, it } from 'vitest'
import { availableToSpend } from './available'
import { totalMoney, accountBalance } from './balances'
import { learnRule, suggestCategory } from './categorize'
import { familyContribution } from './contribution'
import { forecastEndOfMonth } from './forecast'
import { debtStatus, goalProgress } from './goals'
import { dueOccurrences, occurrencesBetween, occurrenceToTransaction } from './recurring'
import { monthTotals, usualLevels } from './stats'
import { emptyData, tx } from './testData'
import type { AppData, Recurring } from './types'

const D = '2026-01-10'

/** Банк 1000 €, наличные 500 € */
function base(): AppData {
  return emptyData()
}

describe('Обязательные тесты из ТЗ', () => {
  it('Test 1: Bank 1000 + Cash 500 → Total 1500', () => {
    expect(totalMoney(base(), D)).toBe(150000)
  })

  it('Test 2: перевод Bank → Cash 200 не меняет общий капитал', () => {
    const d = base()
    d.transactions.push(tx({ type: 'transfer', amount: 20000, date: '2026-01-05', fromAccountId: 'bank', toAccountId: 'cash' }))
    expect(totalMoney(d, D)).toBe(150000)
    expect(accountBalance(d.accounts[0], d.transactions, D)).toBe(80000)
    expect(accountBalance(d.accounts[1], d.transactions, D)).toBe(70000)
  })

  it('Test 3: расход наличными 100 → Total 1400', () => {
    const d = base()
    d.transactions.push(tx({ type: 'expense', amount: 10000, date: '2026-01-05', accountId: 'cash', categoryId: 'cafe' }))
    expect(totalMoney(d, D)).toBe(140000)
  })

  it('Test 4: доход 500 → Total 1900 (после расхода 100)', () => {
    const d = base()
    d.transactions.push(tx({ type: 'expense', amount: 10000, date: '2026-01-05', accountId: 'cash', categoryId: 'cafe' }))
    d.transactions.push(tx({ type: 'income', amount: 50000, date: '2026-01-06', accountId: 'bank', categoryId: 'salary' }))
    expect(totalMoney(d, D)).toBe(190000)
  })

  it('Test 5: будущий расход 300 уменьшает «Можно потратить» на 300', () => {
    const d = base()
    const before = availableToSpend(d, D).available
    d.transactions.push(tx({ type: 'expense', status: 'planned', amount: 30000, date: '2026-01-25', accountId: 'bank', categoryId: 'rent' }))
    const after = availableToSpend(d, D).available
    expect(before - after).toBe(30000)
    // а общий капитал не меняется, пока расход не проведён
    expect(totalMoney(d, D)).toBe(150000)
  })

  it('Test 6: перевод никогда не попадает в статистику трат', () => {
    const d = base()
    d.transactions.push(tx({ type: 'transfer', amount: 20000, date: '2026-01-05', fromAccountId: 'bank', toAccountId: 'cash' }))
    d.transactions.push(tx({ type: 'transfer', amount: 5000, date: '2026-01-06', fromAccountId: 'bank', toAccountId: 'savings' }))
    d.transactions.push(tx({ type: 'expense', amount: 1500, date: '2026-01-07', accountId: 'cash', categoryId: 'cafe' }))
    const t = monthTotals(d, '2026-01')
    expect(t.expense).toBe(1500)
    expect(Object.keys(t.byCategory)).toEqual(['cafe'])
  })
})

describe('Балансы и «Можно потратить»', () => {
  it('операции до даты якоря не меняют баланс (только история)', () => {
    const d = base()
    d.transactions.push(tx({ type: 'expense', amount: 99999, date: '2025-12-20', accountId: 'bank', categoryId: 'cafe' }))
    expect(totalMoney(d, D)).toBe(150000)
  })

  it('накопления входят в общий капитал, но не в «Можно потратить»', () => {
    const d = base()
    d.transactions.push(tx({ type: 'transfer', amount: 30000, date: '2026-01-05', fromAccountId: 'bank', toAccountId: 'savings' }))
    const a = availableToSpend(d, D)
    expect(a.total).toBe(150000)
    expect(a.savings).toBe(30000)
    expect(a.available).toBe(120000)
  })

  it('ожидающее списание и отложенное на цель вычитаются, ожидаемый доход — нет', () => {
    const d = base()
    d.transactions.push(tx({ type: 'expense', status: 'pending', amount: 16700, date: D, accountId: 'bank', categoryId: 'cafe' }))
    d.transactions.push(tx({ type: 'income', status: 'planned', amount: 250000, date: '2026-01-27', accountId: 'bank', categoryId: 'salary' }))
    d.goals.push({ id: 'g', name: 'Долг', target: 170000, current: 14200, reserve: true })
    const a = availableToSpend(d, D)
    expect(a.available).toBe(150000 - 16700 - 14200)
    expect(a.expectedIncome).toBe(250000)
  })

  it('регулярный платёж до конца месяца вычитается один раз, после подтверждения — не вычитается повторно', () => {
    const d = base()
    const rent: Recurring = { id: 'r', name: 'Аренда', type: 'expense', amount: 80000, categoryId: 'rent', accountId: 'bank', owner: 'family', scope: 'family', frequency: 'monthly', startDate: '2025-12-30', active: true, confidence: 'high' }
    d.recurring.push(rent)
    expect(availableToSpend(d, D).upcoming).toBe(80000)
    // платёж проведён — баланс уменьшился, обязательство исчезло: итог тот же, двойного учёта нет
    const occ = { recurring: rent, date: '2026-01-30', state: 'due' as const }
    d.transactions.push(occurrenceToTransaction(occ, 'x'))
    const a = availableToSpend(d, '2026-01-30')
    expect(a.upcoming).toBe(0)
    expect(a.available).toBe(150000 - 80000)
  })
})

describe('Бюджет до зарплаты (зарплатный период)', () => {
  const rec = (id: string, day: string, amount: number, type: 'income' | 'expense' = 'expense', month = '10'): Recurring => ({
    id, name: id, type, amount, categoryId: type === 'income' ? 'salary' : 'rent', accountId: 'bank', owner: 'a', scope: 'family',
    frequency: 'monthly', startDate: `2026-${month}-${day}`, active: true, confidence: 'high',
  })
  const setup = () => {
    const d = base()
    d.settings.trackingStart = '2026-10-01'
    d.accounts.forEach((a) => (a.anchor.date = '2026-09-30'))
    d.recurring.push(rec('salary', '27', 250000, 'income'), rec('rent', '30', 80000), rec('phone', '09', 5000))
    return d
  }

  it('аренда и школа после зарплаты не вычитаются — их оплатит новая зарплата; платежи до зарплаты вычитаются', () => {
    const a = availableToSpend(setup(), '2026-10-07')
    expect(a.cycle.nextPayday).toBe('2026-10-27')
    expect(a.horizon).toBe('2026-10-26')
    expect(a.available).toBe(150000 - 5000) // только телефон 9-го
  })

  it('будущие доходы не прибавляются (зарплата, непостоянный доход партнёра)', () => {
    const d = setup()
    d.recurring.push({ ...rec('minijob', '10', 60300, 'income'), owner: 'b' })
    expect(availableToSpend(d, '2026-10-07').available).toBe(150000 - 5000)
  })

  it('зарплата пришла раньше срока и отмечена — новый период начинается сразу', () => {
    const d = setup()
    d.transactions.push(tx({ type: 'income', amount: 250000, date: '2026-10-26', accountId: 'bank', categoryId: 'salary', recurringId: 'salary', occurrence: '2026-10-27' }))
    d.transactions.push(tx({ type: 'expense', amount: 5000, date: '2026-10-09', accountId: 'bank', recurringId: 'phone', occurrence: '2026-10-09' }))
    const a = availableToSpend(d, '2026-10-26')
    expect(a.cycle.paidEarly).toBe(true)
    expect(a.horizon).toBe('2026-11-26')
    // остаток с зарплатой − аренда 30.10 − телефон 9.11
    expect(a.available).toBe(150000 - 5000 + 250000 - 80000 - 5000)
  })

  it('зарплата задержалась — аренда уже вычитается и есть предупреждение', () => {
    const d = setup()
    d.transactions.push(tx({ type: 'expense', amount: 5000, date: '2026-10-09', accountId: 'bank', recurringId: 'phone', occurrence: '2026-10-09' }))
    const a = availableToSpend(d, '2026-10-28')
    expect(a.cycle.salaryLate).toBe(true)
    expect(a.available).toBe(150000 - 5000 - 80000 - 5000)
  })
})

describe('Регулярные платежи', () => {
  const r: Recurring = { id: 'k', name: 'Страховка', type: 'expense', amount: 51719, categoryId: 'rent', accountId: 'bank', owner: 'family', scope: 'family', frequency: 'semiannual', startDate: '2025-12-29', active: true, confidence: 'medium' }

  it('даты раз в полгода', () => {
    expect(occurrencesBetween(r, '2026-01-01', '2027-01-31')).toEqual(['2026-06-29', '2026-12-29'])
  })

  it('день 31 переносится на последний день короткого месяца', () => {
    const m = { ...r, frequency: 'monthly' as const, startDate: '2026-01-31' }
    expect(occurrencesBetween(m, '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31'])
  })

  it('наступивший неподтверждённый платёж попадает в «ждут подтверждения»', () => {
    const d = base()
    d.recurring.push({ ...r, frequency: 'monthly', startDate: '2026-01-05' })
    expect(dueOccurrences(d, D).map((o) => o.date)).toEqual(['2026-01-05'])
    d.skipped.push({ recurringId: 'k', occurrence: '2026-01-05' })
    expect(dueOccurrences(d, D)).toHaveLength(0)
  })
})

describe('Статистика и бюджет', () => {
  function history(): AppData {
    const d = emptyData({ settings: { theme: 'system', currency: 'EUR', savingsTarget: 0, coverage: [{ from: '2025-07-01', to: '2025-12-31', label: 'выписки' }], trackingStart: '2026-01-01' } })
    const cafe = [100, 120, 110, 400, 90, 130] // один выброс
    ;['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'].forEach((m, i) => {
      d.transactions.push(tx({ type: 'expense', amount: cafe[i] * 100, date: `${m}-10`, accountId: 'bank', categoryId: 'cafe' }))
      d.transactions.push(tx({ type: 'expense', amount: 30000, date: `${m}-11`, accountId: 'bank', categoryId: 'groceries' }))
      d.transactions.push(tx({ type: 'income', amount: 100000, date: `${m}-27`, accountId: 'bank', categoryId: 'salary' }))
    })
    return d
  }

  it('«обычный» уровень — медиана, выброс не искажает', () => {
    const u = usualLevels(history(), '2026-01')
    expect(u.months).toHaveLength(6)
    expect(u.byCategory.cafe).toBe(11500)
    expect(u.byCategory.groceries).toBe(30000)
  })

  it('месяц без данных не считается нулевым', () => {
    const d = history()
    d.settings.coverage = [{ from: '2025-09-01', to: '2025-12-31', label: '' }]
    expect(usualLevels(d, '2026-01').months).toEqual(['2025-12', '2025-11', '2025-10', '2025-09'])
  })

  it('план: сначала подушка 10% дохода, необходимое 90% привычки, желания — остаток', () => {
    const p = moneyPlan(history(), '2026-01-15')
    expect(p.income).toBe(100000)
    expect(p.free).toBe(100000)
    expect(p.cushion).toBe(10000)
    const g = p.envelopes.find((e) => e.category.id === 'groceries')!
    const c = p.envelopes.find((e) => e.category.id === 'cafe')!
    expect(g.limit).toBe(27000) // 90% от 300 €
    expect(c.limit).toBe(11500) // желания не больше привычного уровня
    expect(p.extra).toBe(100000 - 10000 - 27000 - 11500)
    expect(p.cushionTotal).toBe(p.cushion + p.extra)
  })

  it('план: если денег мало — подушка уменьшается до остатка (не меньше 5%), желания урезаются первыми', () => {
    const d = history()
    d.transactions.filter((t) => t.type === 'income').forEach((t) => (t.amount = 29000))
    const p = moneyPlan(d, '2026-01-15')
    expect(p.cushionRule).toBe('auto-min')
    expect(p.cushion).toBe(2000) // 290 − 270 на продукты; это больше минимальных 5% (14,50 €)
    expect(p.envelopes.find((e) => e.category.id === 'groceries')!.limit).toBe(27000)
    expect(p.envelopes.find((e) => e.category.id === 'cafe')!.limit).toBe(0)
    expect(p.shortfall).toBe(0)

    d.transactions.filter((t) => t.type === 'income').forEach((t) => (t.amount = 20000))
    const q = moneyPlan(d, '2026-01-15')
    expect(q.cushion).toBe(1000) // минимум 5% откладываем всегда
    expect(q.envelopes.find((e) => e.category.id === 'groceries')!.limit).toBe(19000)
  })

  it('план: ручной лимит перекрывает расчёт, перерасход виден как нехватка', () => {
    const d = history()
    d.settings.envelopeOverrides = { cafe: 90000 }
    const p = moneyPlan(d, '2026-01-15')
    expect(p.envelopes.find((e) => e.category.id === 'cafe')!.overridden).toBe(true)
    expect(p.shortfall).toBe(90000 + 27000 + 10000 - 100000)
  })

  it('объединённая категория (переводы на покупки) входит в базу продуктов', () => {
    const d = history()
    d.categories.push({ id: 'transfers', name: 'Переводы', kind: 'expense', mergeInto: 'groceries', color: '#000' })
    ;['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'].forEach((m) => d.transactions.push(tx({ type: 'expense', amount: 10000, date: `${m}-15`, accountId: 'bank', categoryId: 'transfers' })))
    const g = moneyPlan(d, '2026-01-15').envelopes.find((e) => e.category.id === 'groceries')!
    expect(g.habit).toBe(40000)
    expect(g.limit).toBe(36000)
  })
})

describe('Цели и долги', () => {
  it('ежемесячный взнос: 1700 € за 12 месяцев ≈ 142 €', () => {
    const g = goalProgress({ id: 'g', name: 'Долг', target: 170000, current: 0, targetDate: '2027-09-01', reserve: true }, '2026-09-29')
    expect(g.monthsLeft).toBe(12)
    expect(g.monthlyRequired).toBe(14167)
  })

  it('остаток долга учитывает прошедшие удержания и проведённые платежи', () => {
    const d = base()
    d.debts.push({ id: 'loan', name: 'Работодатель', lender: 'Работодатель', principal: 500000, totalToRepay: 530000, interestRate: null, confidence: 'medium', deductions: [{ date: '2026-01-05', amount: 30000 }, { date: '2026-02-05', amount: 30000 }] })
    d.transactions.push(tx({ type: 'expense', status: 'planned', amount: 170000, date: '2026-09-30', accountId: 'bank', debtId: 'loan' }))
    const s = debtStatus(d, d.debts[0], D)
    expect(s.paid).toBe(30000)
    expect(s.remaining).toBe(500000)
    expect(s.finalDate).toBe('2026-09-30')
  })
})

describe('Прогноз', () => {
  it('конец месяца = деньги + ожидаемый доход − известные платежи − оценка переменных трат', () => {
    const d = base()
    d.transactions.push(tx({ type: 'income', status: 'planned', amount: 200000, date: '2026-01-27', accountId: 'bank', categoryId: 'salary' }))
    d.transactions.push(tx({ type: 'expense', status: 'planned', amount: 80000, date: '2026-01-30', accountId: 'bank', categoryId: 'rent' }))
    const f = forecastEndOfMonth(d, D)
    expect(f.start).toBe(150000)
    expect(f.end).toBe(150000 + 200000 - 80000 - f.variable)
  })
})

describe('Категоризация', () => {
  it('запоминает исправление пользователя', () => {
    const d = base()
    d.rules.push({ id: 's', keyword: 'rewe', categoryId: 'cafe', source: 'seed', hits: 0 })
    expect(suggestCategory(d.rules, 'REWE Berlin')?.categoryId).toBe('cafe')
    d.rules = learnRule(d, 'REWE', 'groceries', 'family', () => 'u1')
    expect(suggestCategory(d.rules, 'REWE Berlin')?.categoryId).toBe('groceries')
    expect(suggestCategory(d.rules, 'rewe')?.confidence).toBe('high')
  })
})

describe('Вклад членов семьи', () => {
  it('считает доход, общие и личные траты по плательщику', () => {
    const d = base()
    d.transactions.push(tx({ type: 'income', amount: 250000, date: D, accountId: 'bank', owner: 'a', categoryId: 'salary' }))
    d.transactions.push(tx({ type: 'income', amount: 60300, date: D, accountId: 'bank', owner: 'b', categoryId: 'salary' }))
    d.transactions.push(tx({ type: 'expense', amount: 80000, date: D, accountId: 'bank', owner: 'a', scope: 'family', categoryId: 'rent' }))
    d.transactions.push(tx({ type: 'expense', amount: 20000, date: D, accountId: 'bank', owner: 'b', scope: 'family', categoryId: 'groceries' }))
    d.transactions.push(tx({ type: 'expense', amount: 6900, date: D, accountId: 'bank', owner: 'b', scope: 'personal', categoryId: 'cafe' }))
    d.transactions.push(tx({ type: 'transfer', amount: 10000, date: D, fromAccountId: 'bank', toAccountId: 'cash' }))
    const c = familyContribution(d, '2026-01-01', '2026-01-31')
    const t = c.members.find((m) => m.member.id === 'b')!
    expect(c.totalFamily).toBe(100000)
    expect(t.familyPaid).toBe(20000)
    expect(t.personal).toBe(6900)
    expect(t.share).toBeCloseTo(0.2)
    expect(c.savings).toBe(310300 - 100000 - 6900)
  })
})

import { allowances } from './allowances'
import { moneyPlan } from './plan'

describe('Конверты на остаток месяца', () => {
  function hist(): AppData {
    const d = emptyData({ settings: { theme: 'system', currency: 'EUR', savingsTarget: 0, coverage: [{ from: '2025-07-01', to: '2025-12-31', label: '' }], trackingStart: '2026-01-01' } })
    ;['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'].forEach((m) => {
      d.transactions.push(tx({ type: 'expense', amount: 40000, date: `${m}-10`, accountId: 'bank', categoryId: 'groceries' }))
      d.transactions.push(tx({ type: 'expense', amount: 10000, date: `${m}-12`, accountId: 'bank', categoryId: 'cafe' }))
      d.transactions.push(tx({ type: 'income', amount: 100000, date: `${m}-27`, accountId: 'bank', categoryId: 'salary' }))
    })
    return d
  }

  it('осталось = лимит − потрачено; остаток идёт в накопления', () => {
    const d = hist()
    d.transactions.push(tx({ type: 'expense', amount: 15000, date: '2026-01-05', accountId: 'bank', categoryId: 'groceries' }))
    const p = allowances(d, '2026-01-10')
    const g = p.rows.find((r) => r.category.id === 'groceries')!
    expect(g.monthLimit).toBe(36000) // 90% привычных 400 €
    expect(g.spent).toBe(15000)
    expect(g.left).toBe(21000)
    expect(p.leftover).toBe(p.available - p.allocated)
  })

  it('при нехватке денег сначала ужимаются необязательные категории', () => {
    const d = hist()
    d.accounts[0].anchor.amount = 0
    d.accounts[1].anchor.amount = 45000 // всего 450 €, а конверты 360 + 100
    const p = allowances(d, '2026-01-02')
    const g = p.rows.find((r) => r.category.id === 'groceries')!
    const c = p.rows.find((r) => r.category.id === 'cafe')!
    expect(p.squeezed).toBe(true)
    expect(g.left).toBe(36000)
    expect(c.left).toBe(45000 - 36000)
    expect(p.allocated).toBeLessThanOrEqual(p.available)
  })
})
