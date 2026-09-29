import type { Cents } from './types'

export function toCents(euros: number): Cents {
  return Math.round(euros * 100)
}

/** Разбирает ввод пользователя: "12,50", "12.5", "1 200" → центы; null если не число */
export function parseAmount(input: string): Cents | null {
  const s = input.replace(/\s|€/g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null
  const v = Math.round(parseFloat(s) * 100)
  return v > 0 ? v : null
}

const fmt0 = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmt2 = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function eur(c: Cents, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const s = (opts.cents ? fmt2 : fmt0).format(Math.abs(c) / 100)
  if (c < 0) return '−' + s
  if (opts.sign && c > 0) return '+' + s
  return s
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
