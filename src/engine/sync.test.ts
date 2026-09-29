import { describe, expect, it } from 'vitest'
import { mergeData } from './sync'
import { emptyData, tx } from './testData'
import type { AppData } from './types'

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-01T12:00:00.000Z'
const NOW = '2026-10-02T08:00:00.000Z'

function pair(): [AppData, AppData] {
  const base = emptyData()
  base.transactions.push(tx({ id: 'shared', type: 'expense', amount: 1000, date: '2026-10-01', accountId: 'bank', categoryId: 'cafe', updatedAt: T1 }))
  return [structuredClone(base), structuredClone(base)]
}

describe('Синхронизация через общий файл', () => {
  it('операции с двух телефонов складываются', () => {
    const [mine, hers] = pair()
    mine.transactions.push(tx({ id: 'm1', type: 'expense', amount: 500, date: '2026-10-01', accountId: 'bank', categoryId: 'cafe' }))
    hers.transactions.push(tx({ id: 'h1', type: 'expense', amount: 700, date: '2026-10-01', accountId: 'bank', categoryId: 'groceries', owner: 'b' }))
    const { data, stats } = mergeData(mine, hers, NOW)
    expect(data.transactions.map((t) => t.id).sort()).toEqual(['h1', 'm1', 'shared'])
    expect(stats.added).toBe(1)
    // объединение симметрично: второй телефон получит то же самое
    expect(mergeData(hers, mine, NOW).data.transactions.map((t) => t.id).sort()).toEqual(['h1', 'm1', 'shared'])
  })

  it('при правке одной записи на двух телефонах побеждает более свежая', () => {
    const [mine, hers] = pair()
    mine.transactions[0] = { ...mine.transactions[0], amount: 1200, updatedAt: T1 }
    hers.transactions[0] = { ...hers.transactions[0], amount: 1500, updatedAt: T2 }
    expect(mergeData(mine, hers, NOW).data.transactions[0].amount).toBe(1500)
    expect(mergeData(hers, mine, NOW).data.transactions[0].amount).toBe(1500)
  })

  it('удаление доходит до второго телефона', () => {
    const [mine, hers] = pair()
    mine.transactions = []
    mine.deleted = [{ id: 'shared', at: T2 }]
    const { data, stats } = mergeData(hers, mine, NOW)
    expect(data.transactions).toHaveLength(0)
    expect(stats.removed).toBe(1)
  })

  it('правка после удаления сохраняет запись', () => {
    const [mine, hers] = pair()
    mine.transactions = []
    mine.deleted = [{ id: 'shared', at: T1 }]
    hers.transactions[0] = { ...hers.transactions[0], amount: 2000, updatedAt: T2 }
    expect(mergeData(mine, hers, NOW).data.transactions[0].amount).toBe(2000)
  })

  it('регулярный платёж, подтверждённый на обоих телефонах, не дублируется', () => {
    const [mine, hers] = pair()
    mine.transactions.push(tx({ id: 'r-m', type: 'expense', amount: 80000, date: '2026-10-01', accountId: 'bank', recurringId: 'rent', occurrence: '2026-10-01' }))
    hers.transactions.push(tx({ id: 'r-h', type: 'expense', amount: 80000, date: '2026-10-01', accountId: 'bank', recurringId: 'rent', occurrence: '2026-10-01' }))
    const rent = mergeData(mine, hers, NOW).data.transactions.filter((t) => t.recurringId === 'rent')
    expect(rent).toHaveLength(1)
  })

  it('пополнения цели с двух телефонов складываются', () => {
    const [mine, hers] = pair()
    const g = { id: 'g', name: 'Подушка', target: 100000, current: 0, reserve: true, contributions: [] as { id?: string; date: string; amount: number }[] }
    mine.goals = [{ ...g, current: 5000, contributions: [{ id: 'c1', date: '2026-10-01', amount: 5000 }], updatedAt: T1 }]
    hers.goals = [{ ...g, current: 3000, contributions: [{ id: 'c2', date: '2026-10-01', amount: 3000 }], updatedAt: T2 }]
    const goal = mergeData(mine, hers, NOW).data.goals[0]
    expect(goal.current).toBe(8000)
    expect(goal.contributions).toHaveLength(2)
  })

  it('тема и «чей телефон» остаются своими, общие настройки — из более свежей копии', () => {
    const [mine, hers] = pair()
    mine.settings = { ...mine.settings, theme: 'dark', me: 'a', savingsTarget: 10000, updatedAt: T1 }
    hers.settings = { ...hers.settings, theme: 'pink', me: 'b', savingsTarget: 20000, updatedAt: T2 }
    const s = mergeData(mine, hers, NOW).data.settings
    expect(s.theme).toBe('dark')
    expect(s.me).toBe('a')
    expect(s.savingsTarget).toBe(20000)
    expect(s.lastSyncAt).toBe(NOW)
  })
})
