import { availableToSpend } from './available'
import { daysInMonth, monthKey, parseISO } from './dates'
import { moneyPlan, type MoneyPlan } from './plan'
import { monthCoverageRatio, monthTotals } from './stats'
import type { AppData, Category, Cents, ISODate } from './types'

export interface Allowance {
  category: Category
  kind: 'need' | 'want'
  /** лимит категории на месяц по плану */
  monthLimit: Cents
  /** уже потрачено в этом месяце (без регулярных платежей) */
  spent: Cents
  /** сколько ещё можно потратить до конца месяца */
  left: Cents
  /** в день до конца месяца */
  perDay: Cents
  over: boolean
  /** на сколько превышен лимит */
  overBy: Cents
}

export interface AllowancePlan {
  rows: Allowance[]
  plan: MoneyPlan
  available: Cents
  /** сумма конвертов до конца месяца */
  allocated: Cents
  /** останется после конвертов — отложить */
  leftover: Cents
  daysLeft: number
  /** денег на счетах меньше, чем по плану — конверты урезаны */
  squeezed: boolean
  /** учёт начат посреди месяца — лимиты пропорционально оставшимся дням */
  prorated: boolean
}

/**
 * Конверты на остаток месяца по плану moneyPlan: только необходимое и желания.
 * Обязательные платежи сюда не входят — они уже вычтены из «Можно потратить».
 * Осталось = лимит по плану − потрачено в этом месяце. Если на счетах денег меньше,
 * сначала урезаются желания, затем необходимое.
 */
export function allowances(data: AppData, todayISO: ISODate): AllowancePlan {
  const month = monthKey(todayISO)
  const plan = moneyPlan(data, todayISO, month)
  const av = availableToSpend(data, todayISO).available
  const dim = daysInMonth(month)
  const daysLeft = dim - parseISO(todayISO).getDate() + 1
  const prorated = monthCoverageRatio(data, month, todayISO) < 0.9
  const spentMonth = monthTotals(data, month, todayISO).variableByCategory

  const base = plan.envelopes.map((e) => {
    const ids = [e.category.id, ...data.categories.filter((c) => c.mergeInto === e.category.id).map((c) => c.id)]
    const spent = ids.reduce((s, id) => s + (spentMonth[id] ?? 0), 0)
    const limit = prorated ? Math.round((e.limit * daysLeft) / dim) : e.limit
    const raw = limit - spent
    return { category: e.category, kind: e.kind, monthLimit: e.limit, spent, left: Math.max(raw, 0), over: raw < 0, overBy: Math.max(-raw, 0) }
  })

  const pool = Math.max(av, 0)
  let total = base.reduce((s, r) => s + r.left, 0)
  let squeezed = false
  if (total > pool) {
    squeezed = true
    const need = base.filter((r) => r.kind === 'need').reduce((s, r) => s + r.left, 0)
    const want = total - need
    if (need <= pool) {
      const k = want > 0 ? (pool - need) / want : 0
      base.forEach((r) => { if (r.kind === 'want') r.left = Math.floor(r.left * k) })
    } else {
      const k = need > 0 ? pool / need : 0
      base.forEach((r) => { r.left = r.kind === 'need' ? Math.floor(r.left * k) : 0 })
    }
    total = base.reduce((s, r) => s + r.left, 0)
  }

  const rows: Allowance[] = base
    .filter((r) => r.monthLimit >= 500 || r.spent > 0)
    .map((r) => ({ ...r, perDay: Math.floor(r.left / Math.max(daysLeft, 1)) }))

  return { rows, plan, available: av, allocated: total, leftover: av - total, daysLeft, squeezed, prorated }
}
