import { goalsMonthlyRequired } from './goals'
import { moneyPlan, type MoneyPlan } from './plan'
import { isActiveAround, monthlyEquivalent } from './recurring'
import { monthTotals, usualLevels, type UsualLevels } from './stats'
import { monthKey, type MonthKey } from './dates'
import type { AppData, Category, Cents, ISODate } from './types'

/** Максимальная доля, на которую реально сократить переменную часть категории за месяц */
export const CUT_CAP_ESSENTIAL = 0.1
export const CUT_CAP_DISCRETIONARY = 0.35

export interface MonthlyPlan {
  /** Ожидаемый доход в месяц — по регулярным поступлениям (или медиана истории) */
  income: Cents
  incomeSource: 'recurring' | 'history'
  /** Регулярные обязательные платежи в месяц */
  fixed: Cents
  /** Обычные переменные траты в месяц (среднее без разовых операций) */
  variableUsual: Cents
  savingsTarget: Cents
  goalsMonthly: Cents
  /** income − fixed − variableUsual */
  balanceAtUsual: Cents
  /** Сколько можно тратить на переменное, чтобы выполнить цели накоплений */
  variableAllowed: Cents
  /** На сколько нужно сократить переменные траты (0 — не нужно) */
  cutNeeded: Cents
  /** Сколько удаётся сократить в пределах реалистичных лимитов */
  cutAchievable: Cents
  months: MonthKey[]
}

export interface CategoryBudget {
  category: Category
  actual: Cents
  usual: Cents
  fixed: Cents
  variableUsual: Cents
  recommended: Cents
  cut: Cents
  explanation: string
}

export interface BudgetResult {
  plan: MonthlyPlan
  rows: CategoryBudget[]
  usual: UsualLevels
  money: MoneyPlan
}

function fixedByCategory(data: AppData, month: MonthKey): Record<string, Cents> {
  const out: Record<string, Cents> = {}
  for (const r of data.recurring) {
    if (!isActiveAround(r, month) || r.type !== 'expense') continue
    out[r.categoryId] = (out[r.categoryId] ?? 0) + monthlyEquivalent(r)
  }
  return out
}

/**
 * Рекомендуемый бюджет строится от фактических данных семьи, а не от правила 50/30/20:
 * 1. доход берётся из регулярных поступлений;
 * 2. обязательные платежи — из регулярных списаний;
 * 3. на переменные траты остаётся: доход − обязательные − цель накоплений − взносы на цели;
 * 4. если обычные переменные траты больше — сокращение распределяется пропорционально,
 *    не больше 10% для необходимого (продукты, бензин) и 35% для остального.
 */
export function buildBudget(data: AppData, todayISO: ISODate, month: MonthKey = monthKey(todayISO)): BudgetResult {
  const usual = usualLevels(data, month)
  const fixedCat = fixedByCategory(data, month)
  const recurringIncome = data.recurring.filter((r) => isActiveAround(r, month) && r.type === 'income').reduce((s, r) => s + monthlyEquivalent(r), 0)
  const income = recurringIncome > 0 ? recurringIncome : usual.income
  const fixed = Object.values(fixedCat).reduce((s, v) => s + v, 0)
  const cats = data.categories.filter((c) => c.kind === 'expense' && !c.archived)
  // Для денежного потока берём СРЕДНЕЕ переменных трат без разовых крупных операций:
  // сумма медиан по категориям занижает реальные траты, если они неровные по месяцам.
  const variableUsual = Math.max(usual.variableMean, cats.reduce((s, c) => s + (usual.variableByCategory[c.id] ?? 0), 0))
  const money = moneyPlan(data, todayISO, month)
  const savingsTarget = money.cushion
  const goalsMonthly = goalsMonthlyRequired(data, todayISO)
  const variableAllowed = income - fixed - savingsTarget - goalsMonthly
  const cutNeeded = Math.max(variableUsual - Math.max(variableAllowed, 0), 0)

  // Категории в конвертах получают лимит из плана месяца; остальные — прежнее мягкое сокращение
  const envelopeOf = new Map(money.envelopes.map((e) => [e.category.id, e]))
  const capacity = (c: Category) =>
    envelopeOf.has(c.id) || c.mergeInto ? 0 : Math.round((usual.variableByCategory[c.id] ?? 0) * (c.essential ? CUT_CAP_ESSENTIAL : CUT_CAP_DISCRETIONARY))
  const envelopeCut = money.envelopes.reduce((s, e) => s + Math.max(e.habit - e.limit, 0), 0)
  const totalCapacity = cats.reduce((s, c) => s + capacity(c), 0)
  const cutAchievable = Math.min(cutNeeded, envelopeCut + totalCapacity)
  const ratio = totalCapacity > 0 ? Math.max(cutAchievable - envelopeCut, 0) / totalCapacity : 0

  const actualTotals = monthTotals(data, month, todayISO)
  const rows: CategoryBudget[] = cats
    .map((c) => {
      const fixedC = fixedCat[c.id] ?? 0
      const varU = usual.variableByCategory[c.id] ?? 0
      const env = envelopeOf.get(c.id)
      const cut = env ? Math.max(varU - env.limit, 0) : Math.round(capacity(c) * ratio)
      const recommended = env ? fixedC + env.limit : fixedC + varU - cut
      let explanation: string
      if (env) explanation = env.kind === 'need' ? 'Необходимое: реалистичный минимум по плану месяца' : 'Желания: остаток после подушки и необходимого'
      else if (c.mergeInto) explanation = 'Учтено в конверте «' + (data.categories.find((x) => x.id === c.mergeInto)?.name ?? '') + '»'
      else if (cut > 0) explanation = `Сократить переменную часть на ${Math.round((cut / Math.max(varU, 1)) * 100)}%, чтобы выйти на цель накоплений`
      else if (fixedC > 0 && varU === 0) explanation = 'Регулярный платёж — сумма фиксирована'
      else if (cutNeeded === 0) explanation = 'Обычный уровень укладывается в план'
      else explanation = 'Необходимые траты — без сокращения'
      return {
        category: c,
        actual: actualTotals.byCategory[c.id] ?? 0,
        usual: Math.max(usual.byCategory[c.id] ?? 0, fixedC),
        fixed: fixedC,
        variableUsual: varU,
        recommended: c.mergeInto ? 0 : recommended,
        cut: c.mergeInto ? varU : cut,
        explanation,
      }
    })
    .filter((r) => r.actual > 0 || r.usual > 0 || r.recommended > 0)
    .sort((a, b) => b.usual - a.usual || b.actual - a.actual)

  return {
    plan: {
      income,
      incomeSource: recurringIncome > 0 ? 'recurring' : 'history',
      fixed,
      variableUsual,
      savingsTarget,
      goalsMonthly,
      balanceAtUsual: income - fixed - variableUsual,
      variableAllowed,
      cutNeeded,
      cutAchievable,
      months: usual.months,
    },
    rows,
    usual,
    money,
  }
}
