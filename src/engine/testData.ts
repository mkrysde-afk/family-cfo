// Минимальный набор данных для тестов движка (не реальные данные семьи).
import type { AppData, Transaction } from './types'

export function emptyData(over: Partial<AppData> = {}): AppData {
  return {
    version: 1,
    members: [
      { id: 'a', name: 'Анна', color: '#378ADD' },
      { id: 'b', name: 'Борис', color: '#D4537E' },
      { id: 'family', name: 'Семья', isFamily: true, color: '#1D9E75' },
    ],
    accounts: [
      { id: 'bank', name: 'Банк', owner: 'a', kind: 'bank', anchor: { date: '2026-01-01', amount: 100000 } },
      { id: 'cash', name: 'Наличные', owner: 'family', kind: 'cash', anchor: { date: '2026-01-01', amount: 50000 } },
      { id: 'savings', name: 'Накопления', owner: 'family', kind: 'savings', anchor: { date: '2026-01-01', amount: 0 } },
    ],
    categories: [
      { id: 'groceries', name: 'Продукты', kind: 'expense', essential: true, envelope: 'need', color: '#1D9E75' },
      { id: 'cafe', name: 'Кафе', kind: 'expense', envelope: 'want', color: '#D85A30' },
      { id: 'rent', name: 'Жильё', kind: 'expense', essential: true, color: '#378ADD' },
      { id: 'salary', name: 'Зарплата', kind: 'income', color: '#639922' },
    ],
    transactions: [],
    recurring: [],
    skipped: [],
    goals: [],
    debts: [],
    rules: [],
    settings: { theme: 'system', currency: 'EUR', savingsTarget: 0, coverage: [], trackingStart: '2026-01-01' },
    ...over,
  }
}

let n = 0
export function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>): Transaction {
  return { id: `t${++n}`, status: 'posted', description: '', owner: 'a', scope: 'family', ...p }
}
