import { addMonths, dateInMonth, monthEnd, monthKey, monthStart, monthsBetween, parseISO, type MonthKey } from './dates'
import type { AppData, Cents, Frequency, ISODate, Recurring, Transaction } from './types'

export const FREQ_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }
export const FREQ_LABEL: Record<Frequency, string> = {
  monthly: 'ежемесячно',
  quarterly: 'раз в квартал',
  semiannual: 'раз в полгода',
  yearly: 'раз в год',
}

/**
 * Действует ли регулярная операция в плановом периоде месяца m:
 * не закончилась до начала месяца и начнётся не позже чем через один свой период.
 * Так будущая зарплата «после окончания удержаний» не складывается с текущей.
 */
export function isActiveAround(r: Recurring, m: MonthKey): boolean {
  if (!r.active) return false
  if (r.endDate && r.endDate < monthStart(m)) return false
  return r.startDate <= monthEnd(addMonths(m, FREQ_MONTHS[r.frequency]))
}

/** Средняя сумма в месяц */
export function monthlyEquivalent(r: Recurring): Cents {
  return Math.round(r.amount / FREQ_MONTHS[r.frequency])
}

export function annualCost(r: Recurring): Cents {
  return r.amount * (12 / FREQ_MONTHS[r.frequency])
}

/** Даты платежей регулярной операции в интервале [from, to] */
export function occurrencesBetween(r: Recurring, from: ISODate, to: ISODate): ISODate[] {
  const step = FREQ_MONTHS[r.frequency]
  const day = parseISO(r.startDate).getDate()
  const startM = monthKey(r.startDate)
  const out: ISODate[] = []
  // первая подходящая позиция не раньше from
  let k = Math.max(0, Math.floor(monthsBetween(startM, monthKey(from)) / step) - 1)
  for (;;) {
    const d = dateInMonth(addMonths(startM, k * step), day)
    if (d > to) break
    if (r.endDate && d > r.endDate) break
    if (d >= from && d >= r.startDate) out.push(d)
    k++
  }
  return out
}

export type OccurrenceState = 'done' | 'skipped' | 'due' | 'upcoming'

export interface Occurrence {
  recurring: Recurring
  date: ISODate
  state: OccurrenceState
  tx?: Transaction
}

/** Состояние каждой ожидаемой регулярной операции в интервале */
export function occurrences(data: AppData, from: ISODate, to: ISODate, todayISO: ISODate): Occurrence[] {
  const byKey = new Map<string, Transaction>()
  for (const tx of data.transactions) {
    if (tx.recurringId && tx.occurrence) byKey.set(`${tx.recurringId}|${tx.occurrence}`, tx)
  }
  const skipped = new Set(data.skipped.map((s) => `${s.recurringId}|${s.occurrence}`))
  const out: Occurrence[] = []
  for (const r of data.recurring) {
    if (!r.active) continue
    for (const date of occurrencesBetween(r, from, to)) {
      const key = `${r.id}|${date}`
      const tx = byKey.get(key)
      let state: OccurrenceState
      if (tx) state = 'done'
      else if (skipped.has(key)) state = 'skipped'
      else if (date <= todayISO) state = 'due'
      else state = 'upcoming'
      out.push({ recurring: r, date, state, tx })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Регулярные операции, которые нужно подтвердить: дата наступила, а операции нет.
 * Смотрим только с начала ручного учёта — история до этого закрыта выписками.
 */
export function dueOccurrences(data: AppData, todayISO: ISODate): Occurrence[] {
  return occurrences(data, data.settings.trackingStart, todayISO, todayISO).filter((o) => o.state === 'due')
}

/** Превращает ожидаемый платёж в проведённую операцию */
export function occurrenceToTransaction(o: Occurrence, id: string, amount?: Cents, date?: ISODate): Transaction {
  const r = o.recurring
  const accounts = r.type === 'transfer' ? { fromAccountId: r.accountId, toAccountId: r.toAccountId } : { categoryId: r.categoryId, accountId: r.accountId }
  return {
    id,
    type: r.type,
    status: 'posted',
    date: date ?? o.date,
    amount: amount ?? r.amount,
    description: r.name,
    ...accounts,
    owner: r.owner,
    scope: r.scope,
    recurringId: r.id,
    occurrence: o.date,
    origin: 'recurring',
    confidence: 'high',
  }
}
