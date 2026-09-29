import { availableToSpend } from './available'
import { savingsMoney } from './balances'
import { buildBudget } from './budget'
import { debtStatus } from './goals'
import { isActiveAround, monthlyEquivalent } from './recurring'
import { monthKey } from './dates'
import type { AppData, Cents, Confidence, ISODate } from './types'

export interface EmergencyFund {
  /** обязательные расходы в месяц */
  essentialMonthly: Cents
  current: Cents
  target3: Cents
  target6: Cents
  need3: Cents
  need6: Cents
  months: number
  confidence: Confidence
}

export function emergencyFund(data: AppData, todayISO: ISODate): EmergencyFund {
  const essentialIds = new Set(data.categories.filter((c) => c.essential).map((c) => c.id))
  const budget = buildBudget(data, todayISO)
  const fixedEssential = data.recurring
    .filter((r) => isActiveAround(r, monthKey(todayISO)) && r.type === 'expense' && essentialIds.has(r.categoryId))
    .reduce((s, r) => s + monthlyEquivalent(r), 0)
  const variableEssential = [...essentialIds].reduce((s, id) => s + (budget.usual.variableByCategory[id] ?? 0), 0)
  const essentialMonthly = fixedEssential + variableEssential
  const current =
    savingsMoney(data, todayISO) + data.goals.filter((g) => g.emergency && g.reserve).reduce((s, g) => s + g.current, 0)
  const target3 = essentialMonthly * 3
  const target6 = essentialMonthly * 6
  return {
    essentialMonthly,
    current,
    target3,
    target6,
    need3: Math.max(target3 - current, 0),
    need6: Math.max(target6 - current, 0),
    months: essentialMonthly > 0 ? current / essentialMonthly : 0,
    confidence: budget.plan.months.length >= 3 ? 'medium' : 'low',
  }
}

export interface HealthComponent {
  key: string
  label: string
  score: number // 0..max
  max: number
  detail: string
}

export interface FinancialHealth {
  score: number // 0..100
  status: 'Устойчиво' | 'Под контролем' | 'Напряжённо' | 'Критично'
  components: HealthComponent[]
  emergency: EmergencyFund
}

const clamp = (x: number, a = 0, b = 1) => Math.min(Math.max(x, a), b)

/**
 * Индекс финансовой устойчивости 0–100 из пяти прозрачных компонентов:
 *  30 — денежный поток: доход покрывает обязательные + обычные траты (запас ≥10% дохода = максимум)
 *  25 — подушка: месяцев обязательных расходов в накоплениях (6 мес = максимум)
 *  15 — доля обязательных платежей в доходе (≤50% = максимум, ≥90% = 0)
 *  15 — долговая нагрузка: платежи по долгам к доходу (0% = максимум, ≥30% = 0)
 *  15 — «можно потратить» не отрицательно и покрывает остаток месяца
 */
export function financialHealth(data: AppData, todayISO: ISODate): FinancialHealth {
  const b = buildBudget(data, todayISO)
  const p = b.plan
  const ef = emergencyFund(data, todayISO)
  const av = availableToSpend(data, todayISO)
  const income = Math.max(p.income, 1)

  const margin = p.balanceAtUsual / income
  const flow = clamp((margin + 0.1) / 0.2) * 30

  const cushion = clamp(ef.months / 6) * 25

  const fixedRatio = p.fixed / income
  const fixedScore = clamp((0.9 - fixedRatio) / 0.4) * 15

  const debtMonthly = data.debts.reduce((s, d) => {
    const st = debtStatus(data, d, todayISO)
    if (!st.remaining) return s
    const next = st.nextPayments.slice(0, 12)
    return s + Math.round(next.reduce((a, x) => a + x.amount, 0) / 12)
  }, 0)
  const debtRatio = debtMonthly / income
  const debtScore = clamp(1 - debtRatio / 0.3) * 15

  const availScore = av.available <= 0 ? 0 : clamp(av.available / Math.max(p.variableUsual * 0.25, 1)) * 15

  const components: HealthComponent[] = [
    { key: 'flow', label: 'Денежный поток', score: flow, max: 30, detail: `${margin >= 0 ? 'Запас' : 'Дефицит'} ${Math.abs(Math.round(margin * 100))}% дохода при обычных тратах` },
    { key: 'cushion', label: 'Финансовая подушка', score: cushion, max: 25, detail: `${ef.months.toFixed(1).replace('.', ',')} мес. обязательных расходов` },
    { key: 'fixed', label: 'Обязательные платежи', score: fixedScore, max: 15, detail: `${Math.round(fixedRatio * 100)}% дохода` },
    { key: 'debt', label: 'Долговая нагрузка', score: debtScore, max: 15, detail: `${Math.round(debtRatio * 100)}% дохода уходит на долги` },
    { key: 'available', label: 'Свободные деньги', score: availScore, max: 15, detail: av.available <= 0 ? 'После обязательств денег не остаётся' : 'Есть запас до конца месяца' },
  ]
  const score = Math.round(components.reduce((s, c) => s + c.score, 0))
  const status = score >= 75 ? 'Устойчиво' : score >= 55 ? 'Под контролем' : score >= 35 ? 'Напряжённо' : 'Критично'
  return { score, status, components, emergency: ef }
}
