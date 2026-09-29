import { addDays, addMonths, monthEnd, monthKey, monthStart, type MonthKey } from './dates'
import { median } from './money'
import type { AppData, Cents, ISODate, Transaction } from './types'

/** Проведённые расходы/доходы. Переводы НИКОГДА не попадают в статистику трат. */
export function isSpending(tx: Transaction): boolean {
  return tx.type === 'expense' && tx.status === 'posted'
}
export function isIncome(tx: Transaction): boolean {
  return tx.type === 'income' && tx.status === 'posted'
}

export function txInRange(data: AppData, from: ISODate, to: ISODate): Transaction[] {
  return data.transactions.filter((t) => t.date >= from && t.date <= to)
}

function covered(data: AppData, from: ISODate, to: ISODate): boolean {
  // Интервал покрыт, если каждый день лежит в одном из периодов выписок или в периоде ручного учёта.
  const ranges = data.settings.coverage.map((c) => [c.from, c.to] as const)
  let d = from
  while (d <= to) {
    const r = ranges.find(([a, b]) => d >= a && d <= b)
    if (r) {
      d = addDays(r[1], 1)
      continue
    }
    if (d >= data.settings.trackingStart) return true
    return false
  }
  return true
}

/**
 * Полные месяцы с достоверными данными до месяца `before` (не включая его), от новых к старым.
 * Месяц считается полным, если он целиком покрыт выписками или ручным учётом.
 */
export function dataMonths(data: AppData, before: MonthKey, limit = 6): MonthKey[] {
  const out: MonthKey[] = []
  const earliest = data.settings.coverage.reduce((m, c) => (c.from < m ? c.from : m), data.settings.trackingStart)
  for (let m = addMonths(before, -1); monthEnd(m) >= earliest && out.length < limit; m = addMonths(m, -1)) {
    if (covered(data, monthStart(m), monthEnd(m))) out.push(m)
  }
  return out
}

/** Есть ли достоверные данные за часть месяца до даты `upTo` */
export function monthCoverageRatio(data: AppData, m: MonthKey, upTo: ISODate): number {
  const end = upTo < monthEnd(m) ? upTo : monthEnd(m)
  let days = 0
  let ok = 0
  for (let d = monthStart(m); d <= end; d = addDays(d, 1)) {
    days++
    if (covered(data, d, d)) ok++
  }
  return days ? ok / days : 0
}

export interface MonthTotals {
  month: MonthKey
  income: Cents
  expense: Cents
  byCategory: Record<string, Cents>
  /** только нерегулярная (переменная) часть расходов по категориям */
  variableByCategory: Record<string, Cents>
  /** переменные траты без разовых крупных операций (irregular) */
  variableRegular: Cents
}

export function monthTotals(data: AppData, m: MonthKey, upTo?: ISODate): MonthTotals {
  const to = upTo && upTo < monthEnd(m) ? upTo : monthEnd(m)
  const res: MonthTotals = { month: m, income: 0, expense: 0, byCategory: {}, variableByCategory: {}, variableRegular: 0 }
  for (const tx of txInRange(data, monthStart(m), to)) {
    if (isIncome(tx)) res.income += tx.amount
    if (isSpending(tx)) {
      res.expense += tx.amount
      const c = tx.categoryId ?? 'other'
      res.byCategory[c] = (res.byCategory[c] ?? 0) + tx.amount
      if (!tx.recurringId) {
        res.variableByCategory[c] = (res.variableByCategory[c] ?? 0) + tx.amount
        if (!tx.irregular) res.variableRegular += tx.amount
      }
    }
  }
  return res
}

export interface UsualLevels {
  months: MonthKey[]
  /** медиана месячного расхода по категории */
  byCategory: Record<string, Cents>
  /** медиана переменной (нерегулярной) части по категории */
  variableByCategory: Record<string, Cents>
  income: Cents
  expense: Cents
  /** среднее переменных трат в месяц без разовых операций */
  variableMean: Cents
}

/**
 * «Обычный» уровень = медиана за последние (до 6) полных месяцев с данными.
 * Медиана устойчива к разовым крупным тратам.
 */
export function usualLevels(data: AppData, currentMonth: MonthKey, limit = 6): UsualLevels {
  const months = dataMonths(data, currentMonth, limit)
  const totals = months.map((m) => monthTotals(data, m))
  const cats = new Set<string>()
  totals.forEach((t) => Object.keys(t.byCategory).forEach((c) => cats.add(c)))
  const byCategory: Record<string, Cents> = {}
  const variableByCategory: Record<string, Cents> = {}
  for (const c of cats) {
    byCategory[c] = median(totals.map((t) => t.byCategory[c] ?? 0))
    variableByCategory[c] = median(totals.map((t) => t.variableByCategory[c] ?? 0))
  }
  return {
    months,
    byCategory,
    variableByCategory,
    income: median(totals.map((t) => t.income)),
    expense: median(totals.map((t) => t.expense)),
    variableMean: totals.length ? Math.round(totals.reduce((s, t) => s + t.variableRegular, 0) / totals.length) : 0,
  }
}

export function currentMonthOf(todayISO: ISODate): MonthKey {
  return monthKey(todayISO)
}
