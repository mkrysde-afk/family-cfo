import type { ISODate } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): ISODate {
  return toISO(new Date())
}

/** 'YYYY-MM' */
export type MonthKey = string

export function monthKey(d: ISODate): MonthKey {
  return d.slice(0, 7)
}

export function daysInMonth(m: MonthKey): number {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo, 0).getDate()
}

export function monthStart(m: MonthKey): ISODate {
  return `${m}-01`
}

export function monthEnd(m: MonthKey): ISODate {
  return `${m}-${pad(daysInMonth(m))}`
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d)
  x.setDate(x.getDate() + n)
  return toISO(x)
}

/** Дата в месяце m с днём day (обрезается до последнего дня месяца) */
export function dateInMonth(m: MonthKey, day: number): ISODate {
  return `${m}-${pad(Math.min(day, daysInMonth(m)))}`
}

export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const [y1, m1] = from.split('-').map(Number)
  const [y2, m2] = to.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1)
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export function monthName(m: MonthKey, withYear = true): string {
  const [y, mo] = m.split('-').map(Number)
  const n = MONTHS[mo - 1]
  return withYear ? `${n[0].toUpperCase()}${n.slice(1)} ${y}` : n[0].toUpperCase() + n.slice(1)
}

export function formatDate(d: ISODate, withYear = false): string {
  const [y, mo, day] = d.split('-').map(Number)
  return `${day} ${MONTHS_GEN[mo - 1]}${withYear ? ' ' + y : ''}`
}
