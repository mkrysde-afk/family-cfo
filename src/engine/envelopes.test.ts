import { describe, expect, it } from 'vitest'
import { freeBudget } from './envelopes'
import { emptyData, tx } from './testData'

const D = '2026-01-10'

describe('Статьи бюджета до зарплаты (вариант А)', () => {
  it('свободно = можно потратить − остатки статей; трата в статье уменьшает её, а не свободное', () => {
    const d = emptyData()
    d.settings.budgetItems = [{ categoryId: 'groceries', amount: 40000 }]
    const before = freeBudget(d, D)
    expect(before.breakdown.available).toBe(150000)
    expect(before.free).toBe(150000 - 40000)
    d.transactions.push(tx({ type: 'expense', amount: 5000, date: '2026-01-05', accountId: 'bank', categoryId: 'groceries' }))
    const after = freeBudget(d, D)
    expect(after.envelopes[0].spent).toBe(5000)
    expect(after.envelopes[0].left).toBe(35000)
    expect(after.free).toBe(before.free) // свободное не изменилось
  })

  it('трата вне статей уменьшает свободное', () => {
    const d = emptyData()
    d.settings.budgetItems = [{ categoryId: 'groceries', amount: 40000 }]
    d.transactions.push(tx({ type: 'expense', amount: 3000, date: '2026-01-05', accountId: 'bank', categoryId: 'cafe' }))
    expect(freeBudget(d, D).free).toBe(150000 - 3000 - 40000)
  })

  it('перерасход статьи уходит из свободного ровно на сумму перерасхода', () => {
    const d = emptyData()
    d.settings.budgetItems = [{ categoryId: 'groceries', amount: 10000 }]
    d.transactions.push(tx({ type: 'expense', amount: 15000, date: '2026-01-05', accountId: 'bank', categoryId: 'groceries' }))
    const f = freeBudget(d, D)
    expect(f.envelopes[0].left).toBe(-5000)
    expect(f.free).toBe(150000 - 15000) // = исходное свободное (140 000) − перерасход 5 000
  })

  it('траты до начала зарплатного периода в статью не входят', () => {
    const d = emptyData()
    d.settings.budgetItems = [{ categoryId: 'groceries', amount: 40000 }]
    d.transactions.push(tx({ type: 'expense', amount: 9000, date: '2025-12-20', accountId: 'bank', categoryId: 'groceries' }))
    expect(freeBudget(d, D).envelopes[0].spent).toBe(0)
  })
})
