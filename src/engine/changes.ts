import { addMonths, daysInMonth, monthKey, monthName, parseISO, dateInMonth, type MonthKey } from './dates'
import { dataMonths, monthCoverageRatio, monthTotals } from './stats'
import type { AppData, Cents, ISODate } from './types'

export interface CategoryDelta {
  categoryId: string
  current: Cents
  previous: Cents
  delta: Cents
}

export interface WhatChanged {
  label: string
  currentLabel: string
  previousLabel: string
  income: { current: Cents; previous: Cents; delta: Cents }
  expense: { current: Cents; previous: Cents; delta: Cents }
  saved: { current: Cents; previous: Cents; delta: Cents }
  available: { current: Cents; previous: Cents; delta: Cents; since: ISODate } | null
  topCategories: CategoryDelta[]
}

/**
 * Сравнение периодов:
 * — если текущий месяц покрыт данными — «с 1-го числа до сегодня» против того же отрезка прошлого месяца;
 * — иначе — два последних полных месяца с данными.
 */
export function whatChanged(data: AppData, todayISO: ISODate): WhatChanged | null {
  const m = monthKey(todayISO)
  const day = parseISO(todayISO).getDate()
  let cur: ReturnType<typeof monthTotals>
  let prev: ReturnType<typeof monthTotals>
  let label: string
  let currentLabel: string
  let previousLabel: string
  const prevM: MonthKey = addMonths(m, -1)
  if (monthCoverageRatio(data, m, todayISO) >= 0.9 && monthCoverageRatio(data, prevM, dateInMonth(prevM, day)) >= 0.9) {
    cur = monthTotals(data, m, todayISO)
    prev = monthTotals(data, prevM, dateInMonth(prevM, Math.min(day, daysInMonth(prevM))))
    label = `С 1 по ${day} число`
    currentLabel = monthName(m, false)
    previousLabel = monthName(prevM, false)
  } else {
    const months = dataMonths(data, m, 2)
    if (months.length < 2) return null
    cur = monthTotals(data, months[0])
    prev = monthTotals(data, months[1])
    label = 'Последние полные месяцы'
    currentLabel = monthName(months[0], false)
    previousLabel = monthName(months[1], false)
  }
  const d = (a: Cents, b: Cents) => ({ current: a, previous: b, delta: a - b })
  const cats = new Set([...Object.keys(cur.byCategory), ...Object.keys(prev.byCategory)])
  const topCategories = [...cats]
    .map((c) => ({ categoryId: c, current: cur.byCategory[c] ?? 0, previous: prev.byCategory[c] ?? 0, delta: (cur.byCategory[c] ?? 0) - (prev.byCategory[c] ?? 0) }))
    .filter((x) => Math.abs(x.delta) >= 2000)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)

  let available: WhatChanged['available'] = null
  const snaps = (data.snapshots ?? []).filter((s) => s.date < todayISO).sort((a, b) => b.date.localeCompare(a.date))
  const todaySnap = (data.snapshots ?? []).find((s) => s.date === todayISO)
  const base = snaps.find((s) => (parseISO(todayISO).getTime() - parseISO(s.date).getTime()) / 864e5 >= 7) ?? snaps[snaps.length - 1]
  if (base && todaySnap) available = { current: todaySnap.available, previous: base.available, delta: todaySnap.available - base.available, since: base.date }

  return {
    label,
    currentLabel,
    previousLabel,
    income: d(cur.income, prev.income),
    expense: d(cur.expense, prev.expense),
    saved: d(cur.income - cur.expense, prev.income - prev.expense),
    available,
    topCategories,
  }
}
