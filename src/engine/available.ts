import { spendableMoney, totalMoney, savingsMoney } from './balances'
import { monthEnd, monthKey } from './dates'
import { occurrences } from './recurring'
import type { AppData, Cents, ISODate } from './types'

export interface Obligation {
  label: string
  date: ISODate
  amount: Cents
  kind: 'pending' | 'planned' | 'recurring' | 'transfer'
  categoryId?: string
}

function accountKind(data: AppData, id?: string) {
  return data.accounts.find((a) => a.id === id)?.kind
}

/**
 * Известные будущие списания с повседневных счетов до даты `to` (включительно):
 * — pending: уже ждут списания в банке;
 * — planned: будущие операции, введённые пользователем (включая наступившие, но не подтверждённые);
 * — recurring: регулярные платежи, ещё не проведённые;
 * — transfer: запланированные переводы с повседневного счёта в накопления.
 */
export function obligationsUntil(data: AppData, to: ISODate, todayISO: ISODate): Obligation[] {
  const out: Obligation[] = []
  for (const tx of data.transactions) {
    if (tx.status === 'posted' || tx.date > to) continue
    if (tx.type === 'expense') {
      if (accountKind(data, tx.accountId) === 'savings') continue
      out.push({ label: tx.description, date: tx.date, amount: tx.amount, kind: tx.status === 'pending' ? 'pending' : 'planned', categoryId: tx.categoryId })
    } else if (tx.type === 'transfer') {
      const fromSpendable = accountKind(data, tx.fromAccountId) !== 'savings'
      const toSpendable = accountKind(data, tx.toAccountId) !== 'savings'
      if (fromSpendable && !toSpendable) out.push({ label: tx.description || 'Перевод в накопления', date: tx.date, amount: tx.amount, kind: 'transfer' })
    }
  }
  for (const o of occurrences(data, data.settings.trackingStart, to, todayISO)) {
    const r = o.recurring
    if (o.state !== 'due' && o.state !== 'upcoming') continue
    if (accountKind(data, r.accountId) === 'savings') continue
    if (r.type === 'expense') out.push({ label: r.name, date: o.date, amount: r.amount, kind: 'recurring', categoryId: r.categoryId })
    else if (r.type === 'transfer' && accountKind(data, r.toAccountId) === 'savings') out.push({ label: r.name, date: o.date, amount: r.amount, kind: 'transfer' })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export interface ExpectedIncome {
  label: string
  date: ISODate
  amount: Cents
}

/** Ожидаемые поступления на повседневные счета до даты `to` */
export function expectedIncomeUntil(data: AppData, to: ISODate, todayISO: ISODate): ExpectedIncome[] {
  const out: ExpectedIncome[] = []
  for (const tx of data.transactions) {
    if (tx.type !== 'income' || tx.status === 'posted' || tx.date > to) continue
    out.push({ label: tx.description, date: tx.date, amount: tx.amount })
  }
  for (const o of occurrences(data, data.settings.trackingStart, to, todayISO)) {
    if (o.recurring.type !== 'income') continue
    if (o.state !== 'due' && o.state !== 'upcoming') continue
    out.push({ label: o.recurring.name, date: o.date, amount: o.recurring.amount })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Отложено на цели. Если цель копит на платёж по долгу и этот платёж уже попал в горизонт
 * (вычитается как обязательство) — резерв не вычитается второй раз.
 */
export function reservedAmount(data: AppData, horizon?: ISODate): Cents {
  return data.goals
    .filter((g) => g.reserve)
    .filter((g) => !(horizon && g.debtId && data.transactions.some((t) => t.debtId === g.debtId && t.status !== 'posted' && t.date <= horizon)))
    .reduce((s, g) => s + Math.min(Math.max(g.current, 0), g.target), 0)
}

export interface AvailableBreakdown {
  total: Cents
  savings: Cents
  spendable: Cents
  pending: Cents
  upcoming: Cents
  reserved: Cents
  available: Cents
  expectedIncome: Cents
  obligations: Obligation[]
  incomes: ExpectedIncome[]
  horizon: ISODate
}

/**
 * «Можно потратить сейчас» =
 *   деньги на повседневных счетах (без накоплений)
 *   − ожидающие списания
 *   − известные платежи до конца месяца
 *   − суммы, отложенные на цели
 * Ожидаемый доход НЕ прибавляется: пока деньги не пришли, тратить их нельзя.
 */
export function availableToSpend(data: AppData, todayISO: ISODate): AvailableBreakdown {
  const horizon = monthEnd(monthKey(todayISO))
  const obligations = obligationsUntil(data, horizon, todayISO)
  const incomes = expectedIncomeUntil(data, horizon, todayISO)
  const pending = obligations.filter((o) => o.kind === 'pending').reduce((s, o) => s + o.amount, 0)
  const upcoming = obligations.filter((o) => o.kind !== 'pending').reduce((s, o) => s + o.amount, 0)
  const spendable = spendableMoney(data, todayISO)
  const reserved = reservedAmount(data, horizon)
  return {
    total: totalMoney(data, todayISO),
    savings: savingsMoney(data, todayISO),
    spendable,
    pending,
    upcoming,
    reserved,
    available: spendable - pending - upcoming - reserved,
    expectedIncome: incomes.reduce((s, i) => s + i.amount, 0),
    obligations,
    incomes,
    horizon,
  }
}
