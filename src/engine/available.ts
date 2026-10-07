import { spendableMoney, totalMoney, savingsMoney } from './balances'
import { addDays, addMonths, dateInMonth, monthKey } from './dates'
import { monthlyEquivalent } from './recurring'
import { occurrences } from './recurring'
import type { AppData, Cents, ISODate } from './types'

export interface Obligation {
  label: string
  date: ISODate
  amount: Cents
  kind: 'pending' | 'planned' | 'recurring' | 'transfer'
  categoryId?: string
  /** с какого счёта спишется */
  accountId?: string
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
      out.push({ label: tx.description, date: tx.date, amount: tx.amount, kind: tx.status === 'pending' ? 'pending' : 'planned', categoryId: tx.categoryId, accountId: tx.accountId })
    } else if (tx.type === 'transfer') {
      const fromSpendable = accountKind(data, tx.fromAccountId) !== 'savings'
      const toSpendable = accountKind(data, tx.toAccountId) !== 'savings'
      if (fromSpendable && !toSpendable) out.push({ label: tx.description || 'Перевод в накопления', date: tx.date, amount: tx.amount, kind: 'transfer', accountId: tx.fromAccountId })
    }
  }
  for (const o of occurrences(data, data.settings.trackingStart, to, todayISO)) {
    const r = o.recurring
    if (o.state !== 'due' && o.state !== 'upcoming') continue
    if (accountKind(data, r.accountId) === 'savings') continue
    if (r.type === 'expense') out.push({ label: r.name, date: o.date, amount: r.amount, kind: 'recurring', categoryId: r.categoryId, accountId: r.accountId })
    else if (r.type === 'transfer' && accountKind(data, r.toAccountId) === 'savings') out.push({ label: r.name, date: o.date, amount: r.amount, kind: 'transfer', accountId: r.accountId })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export interface ExpectedIncome {
  label: string
  date: ISODate
  amount: Cents
  accountId?: string
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

export interface PayCycle {
  /** день зарплаты */
  payday: number
  /** начало текущего периода (дата прошлой зарплаты) */
  start: ISODate
  /** дата следующей зарплаты */
  nextPayday: ISODate
  /** последний день периода = день перед следующей зарплатой; до него считаем платежи */
  horizon: ISODate
  /** зарплата уже пришла раньше срока и отмечена — период начался досрочно */
  paidEarly: boolean
  /** срок зарплаты прошёл, а она не отмечена */
  salaryLate: boolean
}

/** Регулярные зарплаты основного получателя (самая крупная регулярная зарплата и её «продолжения») */
function mainSalaries(data: AppData) {
  const incomes = data.recurring.filter((r) => r.type === 'income' && r.active)
  if (!incomes.length) return []
  const top = [...incomes].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a))[0]
  return incomes.filter((r) => r.owner === top.owner && r.categoryId === top.categoryId && r.frequency === 'monthly')
}

function paydayIn(m: string, day: number): ISODate {
  return dateInMonth(m, day)
}

/**
 * Зарплатный период: бюджет живёт от зарплаты до зарплаты, а не по календарному месяцу.
 * Всё, что списывается после дня зарплаты (аренда 30-го, школа), — первые траты из НОВОЙ зарплаты.
 * Если зарплату отметили раньше срока, новый период начинается сразу.
 */
export function payCycle(data: AppData, todayISO: ISODate): PayCycle {
  const salaries = mainSalaries(data)
  const day = data.settings.payday ?? (salaries[0] ? Number(salaries[0].startDate.slice(8)) : 1)
  const m = monthKey(todayISO)
  // ближайший день зарплаты строго после сегодня
  let next = paydayIn(m, day)
  if (next <= todayISO) next = paydayIn(addMonths(m, 1), day)
  const prev = paydayIn(addMonths(monthKey(next), -1), day)
  const ids = new Set(salaries.map((r) => r.id))
  const received = (around: ISODate) =>
    data.transactions.some((t) => t.type === 'income' && t.status === 'posted' && t.recurringId && ids.has(t.recurringId) && t.occurrence && Math.abs(Date.parse(t.occurrence) - Date.parse(around)) <= 7 * 864e5)
  // зарплата следующего периода уже пришла и отмечена раньше срока → период сдвигается
  const paidEarly = salaries.length > 0 && received(next) && next > todayISO
  const nextPayday = paidEarly ? paydayIn(addMonths(monthKey(next), 1), day) : next
  const start = paidEarly ? next : prev
  const salaryLate = salaries.length > 0 && !paidEarly && prev <= todayISO && prev >= data.settings.trackingStart && !received(prev)
  return { payday: day, start, nextPayday, horizon: addDays(nextPayday, -1), paidEarly, salaryLate }
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
  cycle: PayCycle
}

/**
 * «Можно потратить до зарплаты» =
 *   деньги на повседневных счетах (без накоплений)
 *   − ожидающие списания
 *   − обязательные и запланированные платежи до дня перед следующей зарплатой
 *   − суммы, отложенные на цели
 * Будущие доходы НЕ прибавляются (ни зарплата, ни непостоянный доход): тратим только то, что уже есть.
 * Платежи после дня зарплаты относятся к следующему периоду — их оплатит новая зарплата.
 */
export function availableToSpend(data: AppData, todayISO: ISODate): AvailableBreakdown {
  const cycle = payCycle(data, todayISO)
  const horizon = cycle.horizon
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
    cycle,
  }
}
