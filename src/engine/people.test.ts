import { describe, expect, it } from 'vitest'
import { availableToSpend } from './available'
import { monthMandatory, peopleBudget, plannedSpending } from './people'
import { emptyData, tx } from './testData'
import type { AppData } from './types'

const D = '2026-10-07'

function family(): AppData {
  const d = emptyData()
  d.settings.trackingStart = '2026-10-01'
  d.accounts = [
    { id: 'a-bank', name: 'Карта А', owner: 'a', kind: 'bank', anchor: { date: '2026-09-30', amount: 100000 } },
    { id: 'b-bank', name: 'Карта Б', owner: 'b', kind: 'bank', anchor: { date: '2026-09-30', amount: 20000 } },
    { id: 'cash', name: 'Наличные', owner: 'family', kind: 'cash', anchor: { date: '2026-09-30', amount: 5000 } },
  ]
  d.recurring.push({ id: 'rent', name: 'Аренда', type: 'expense', amount: 80000, categoryId: 'rent', accountId: 'a-bank', owner: 'a', scope: 'family', frequency: 'monthly', startDate: '2026-10-30', active: true, confidence: 'high' })
  d.recurring.push({ id: 'gym', name: 'Спортзал', type: 'expense', amount: 6900, categoryId: 'rent', accountId: 'b-bank', owner: 'b', scope: 'personal', frequency: 'monthly', startDate: '2026-10-01', active: true, confidence: 'high' })
  d.transactions.push(tx({ type: 'income', amount: 60300, date: '2026-10-05', accountId: 'b-bank', owner: 'b', categoryId: 'salary' }))
  return d
}

describe('Главный экран: люди, обязательные и запланированное', () => {
  it('остаток человека = его карта − то, что с неё спишется; сумма сходится с общим бюджетом', () => {
    const d = family()
    d.transactions.push(tx({ type: 'expense', status: 'planned', amount: 4000, date: '2026-10-15', accountId: 'b-bank', owner: 'b', categoryId: 'cafe', description: 'Маникюр' }))
    const p = peopleBudget(d, D)
    const a = p.people.find((x) => x.member.id === 'a')!
    const b = p.people.find((x) => x.member.id === 'b')!
    expect(a.remaining).toBe(100000 - 80000)
    expect(b.balance).toBe(20000 + 60300)
    expect(b.remaining).toBe(20000 + 60300 - 6900 - 4000) // спортзал 1-го ещё не подтверждён + маникюр
    expect(b.incomeMonth).toBe(60300)
    const total = p.people.reduce((s, x) => s + x.remaining, 0) + p.shared.remaining - p.reserved
    expect(total).toBe(availableToSpend(d, D).available)
  })

  it('обязательные платежи месяца: подтверждённый — оплачен, наступивший — ждёт, будущий — впереди', () => {
    const d = family()
    const items = monthMandatory(d, D)
    expect(items.map((i) => `${i.label}:${i.state}`)).toEqual(['Спортзал:due', 'Аренда:upcoming'])
    d.transactions.push(tx({ type: 'expense', amount: 6900, date: '2026-10-01', accountId: 'b-bank', recurringId: 'gym', occurrence: '2026-10-01' }))
    expect(monthMandatory(d, D).find((i) => i.label === 'Спортзал')!.state).toBe('paid')
  })

  it('запланированная трата уменьшает бюджет сразу, а после галочки не вычитается второй раз', () => {
    const d = family()
    const before = availableToSpend(d, D).available
    d.transactions.push(tx({ id: 'nails', type: 'expense', status: 'planned', amount: 4000, date: '2026-10-15', accountId: 'b-bank', owner: 'b', categoryId: 'cafe', description: 'Маникюр' }))
    expect(availableToSpend(d, D).available).toBe(before - 4000)
    expect(plannedSpending(d, D).now.map((t) => t.description)).toEqual(['Маникюр'])
    // отметили галочкой — стала обычным расходом
    d.transactions = d.transactions.map((t) => (t.id === 'nails' ? { ...t, status: 'posted', date: D } : t))
    expect(availableToSpend(d, D).available).toBe(before - 4000)
    expect(plannedSpending(d, D).now).toHaveLength(0)
  })
})
