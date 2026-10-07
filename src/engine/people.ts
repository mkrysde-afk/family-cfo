import { accountBalance } from './balances'
import { obligationsUntil, payCycle, reservedAmount } from './available'
import { occurrences } from './recurring'
import type { Account, AppData, Cents, ISODate, Member, Transaction } from './types'

export interface PersonBudget {
  member: Member
  accounts: Account[]
  /** деньги на его/её картах сейчас */
  balance: Cents
  /** что ещё спишется с этих карт до конца месяца (обязательные, запланированные, ожидающие) */
  obligations: Cents
  /** остаток = деньги на карте − то, что спишется с неё до следующей зарплаты */
  remaining: Cents
  /** доход за текущий зарплатный период (уже поступивший) */
  incomeMonth: Cents
  /** остаток карты известен неточно */
  uncertain: boolean
}

export interface PeopleBudget {
  people: PersonBudget[]
  /** общие счета (наличные и т. п.) — остаток */
  shared: { balance: Cents; remaining: Cents }
  /** отложено на цели (вычитается из общего бюджета, а не из конкретной карты) */
  reserved: Cents
}

/**
 * Остаток по каждому члену семьи: деньги на его/её повседневных счетах минус то,
 * что с этих счетов ещё спишется до следующей зарплаты. Сумма остатков + общие счета − отложенное
 * равна общему бюджету «Можно потратить».
 */
export function peopleBudget(data: AppData, todayISO: ISODate): PeopleBudget {
  const horizon = payCycle(data, todayISO).horizon
  const obligations = obligationsUntil(data, horizon, todayISO)
  const spendable = data.accounts.filter((a) => !a.archived && a.kind !== 'savings')
  const sumFor = (accs: Account[]) => {
    const ids = new Set(accs.map((a) => a.id))
    const balance = accs.reduce((s, a) => s + accountBalance(a, data.transactions, todayISO), 0)
    const obl = obligations.filter((o) => o.accountId && ids.has(o.accountId)).reduce((s, o) => s + o.amount, 0)
    return { balance, obligations: obl, remaining: balance - obl }
  }
  const from = payCycle(data, todayISO).start
  const people = data.members
    .filter((m) => !m.isFamily)
    .map((member) => {
      const accounts = spendable.filter((a) => a.owner === member.id)
      const incomeMonth = data.transactions
        .filter((t) => t.type === 'income' && t.status === 'posted' && t.owner === member.id && t.date >= from && t.date <= todayISO)
        .reduce((s, t) => s + t.amount, 0)
      return { member, accounts, ...sumFor(accounts), incomeMonth, uncertain: accounts.some((a) => a.balanceConfidence === 'low') }
    })
  const sharedAccs = spendable.filter((a) => !data.members.some((m) => !m.isFamily && m.id === a.owner))
  const sh = sumFor(sharedAccs)
  return { people, shared: { balance: sh.balance, remaining: sh.remaining }, reserved: reservedAmount(data, horizon) }
}

export type MandatoryState = 'paid' | 'due' | 'upcoming' | 'pending'

export interface MandatoryItem {
  key: string
  label: string
  date: ISODate
  amount: Cents
  state: MandatoryState
  /** поступление (зарплата, Kindergeld), ждущее подтверждения */
  income?: boolean
  recurringId?: string
  txId?: string
}

/**
 * Обязательные платежи текущего зарплатного периода (оплачено / ждёт подтверждения / впереди)
 * плюс неподтверждённые платежи прошлых периодов и поступления, ждущие подтверждения.
 */
export function monthMandatory(data: AppData, todayISO: ISODate): MandatoryItem[] {
  const cycle = payCycle(data, todayISO)
  const items: MandatoryItem[] = []
  for (const o of occurrences(data, data.settings.trackingStart, cycle.horizon, todayISO)) {
    if (o.state === 'skipped' || o.recurring.type === 'transfer') continue
    const thisMonth = o.date >= cycle.start
    if (o.recurring.type === 'income') {
      if (o.state === 'due') items.push({ key: `${o.recurring.id}|${o.date}`, label: o.recurring.name, date: o.date, amount: o.recurring.amount, state: 'due', income: true, recurringId: o.recurring.id })
      continue
    }
    if (!thisMonth && o.state !== 'due') continue
    items.push({
      key: `${o.recurring.id}|${o.date}`,
      label: o.recurring.name,
      date: o.date,
      amount: o.tx?.amount ?? o.recurring.amount,
      state: o.state === 'done' ? 'paid' : o.state === 'due' ? 'due' : 'upcoming',
      recurringId: o.recurring.id,
    })
  }
  for (const t of data.transactions) {
    if (t.status !== 'pending' || t.type === 'transfer' || t.date > cycle.horizon) continue
    items.push({ key: t.id, label: t.description, date: t.date, amount: t.amount, state: 'pending', txId: t.id, income: t.type === 'income' })
  }
  const order: Record<MandatoryState, number> = { due: 0, pending: 1, upcoming: 2, paid: 3 }
  return items.sort((a, b) => order[a.state] - order[b.state] || a.date.localeCompare(b.date))
}

/** Запланированные траты («маникюр 40 €»): до следующей зарплаты и просроченные, затем более поздние */
export function plannedSpending(data: AppData, todayISO: ISODate): { now: Transaction[]; later: Transaction[] } {
  const end = payCycle(data, todayISO).horizon
  const planned = data.transactions
    .filter((t) => t.status === 'planned' && t.type === 'expense' && !t.recurringId && !t.debtId)
    .sort((a, b) => a.date.localeCompare(b.date))
  return { now: planned.filter((t) => t.date <= end), later: planned.filter((t) => t.date > end) }
}
