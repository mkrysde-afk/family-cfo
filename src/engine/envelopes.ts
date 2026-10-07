import { availableToSpend, type AvailableBreakdown } from './available'
import { moneyPlan } from './plan'
import type { AppData, BudgetItem, Category, Cents, ISODate } from './types'

/** Статьи по умолчанию: продукты и авто/бензин — их нужно держать в резерве сразу */
export const DEFAULT_ITEM_CATEGORIES = ['groceries', 'car']

export interface CycleEnvelope {
  category: Category
  /** сумма статьи на период */
  amount: Cents
  /** задана вручную (иначе — рекомендация CFO) */
  manual: boolean
  /** потрачено в этой категории с начала периода */
  spent: Cents
  /** осталось (может быть отрицательным — перерасход) */
  left: Cents
  /** рекомендация CFO на период */
  suggested: Cents
}

export interface FreeBudget {
  breakdown: AvailableBreakdown
  envelopes: CycleEnvelope[]
  /** зарезервировано в статьях (только положительные остатки) */
  inEnvelopes: Cents
  /** свободно = можно потратить до зарплаты − остатки статей */
  free: Cents
}

export function budgetItems(data: AppData): BudgetItem[] {
  return data.settings.budgetItems ?? DEFAULT_ITEM_CATEGORIES.filter((id) => data.categories.some((c) => c.id === id && !c.archived)).map((categoryId) => ({ categoryId, amount: null }))
}

/**
 * Свободные деньги до зарплаты (вариант «конверты»):
 *   можно потратить до зарплаты − то, что ещё осталось в статьях (продукты, бензин…).
 * Траты в категории статьи уменьшают её остаток; перерасход статьи уже уменьшил деньги на картах,
 * поэтому дополнительно из «свободно» не вычитается.
 * Рекомендация CFO — конверт из плана месяца (необходимое 90% привычки, желания — остаток).
 */
export function freeBudget(data: AppData, todayISO: ISODate): FreeBudget {
  const breakdown = availableToSpend(data, todayISO)
  const { start } = breakdown.cycle
  const plan = moneyPlan(data, todayISO)
  const envelopes: CycleEnvelope[] = []
  for (const item of budgetItems(data)) {
    const category = data.categories.find((c) => c.id === item.categoryId)
    if (!category) continue
    const ids = new Set([category.id, ...data.categories.filter((c) => c.mergeInto === category.id).map((c) => c.id)])
    const spent = data.transactions
      .filter((t) => t.type === 'expense' && t.status === 'posted' && t.categoryId && ids.has(t.categoryId) && t.date >= start && t.date <= todayISO)
      .reduce((s, t) => s + t.amount, 0)
    const suggested = Math.round((plan.envelopes.find((e) => e.category.id === category.id)?.limit ?? 0) / 1000) * 1000
    const amount = item.amount ?? suggested
    envelopes.push({ category, amount, manual: item.amount !== null, spent, left: amount - spent, suggested })
  }
  const inEnvelopes = envelopes.reduce((s, e) => s + Math.max(e.left, 0), 0)
  return { breakdown, envelopes, inEnvelopes, free: breakdown.available - inEnvelopes }
}
