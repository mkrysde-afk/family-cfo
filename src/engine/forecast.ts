import { expectedIncomeUntil, obligationsUntil, reservedAmount, type ExpectedIncome, type Obligation } from './available'
import { spendableMoney } from './balances'
import { buildBudget } from './budget'
import { addMonths, daysInMonth, monthEnd, monthKey, monthStart, parseISO, type MonthKey } from './dates'
import type { AppData, Cents, Confidence, ISODate } from './types'

export interface ForecastResult {
  month: MonthKey
  start: Cents
  startLabel: string
  income: Cents
  incomes: ExpectedIncome[]
  known: Cents
  obligations: Obligation[]
  /** оценка обычных переменных трат за оставшиеся дни */
  variable: Cents
  end: Cents
  /** end − отложенное на цели */
  endFree: Cents
  confidence: Confidence
  notes: string[]
}

/**
 * Прогноз на конец текущего месяца:
 *   деньги сейчас (банк + наличные)
 *   + ожидаемые поступления
 *   − известные платежи (ожидающие, запланированные, регулярные)
 *   − обычные переменные траты за оставшиеся дни (пропорционально)
 */
export function forecastEndOfMonth(data: AppData, todayISO: ISODate): ForecastResult {
  const month = monthKey(todayISO)
  const end = monthEnd(month)
  const start = spendableMoney(data, todayISO)
  const incomes = expectedIncomeUntil(data, end, todayISO)
  const obligations = obligationsUntil(data, end, todayISO)
  const budget = buildBudget(data, todayISO, month)
  const dim = daysInMonth(month)
  const remainingDays = dim - parseISO(todayISO).getDate()
  const variable = Math.round((budget.plan.variableUsual * remainingDays) / dim)
  const income = incomes.reduce((s, i) => s + i.amount, 0)
  const known = obligations.reduce((s, o) => s + o.amount, 0)
  const endBal = start + income - known - variable
  const notes: string[] = []
  if (budget.plan.months.length < 3) notes.push('Мало истории для оценки переменных трат')
  notes.push(`Переменные траты оценены как обычный уровень × ${remainingDays}/${dim} оставшихся дней`)
  return {
    month,
    start,
    startLabel: 'Деньги сейчас',
    income,
    incomes,
    known,
    obligations,
    variable,
    end: endBal,
    endFree: endBal - reservedAmount(data, end),
    confidence: budget.plan.months.length >= 3 ? 'medium' : 'low',
    notes,
  }
}

/** Прогноз на следующий месяц: от прогноза на конец текущего + полный месяц регулярных потоков и обычных трат */
export function forecastNextMonth(data: AppData, todayISO: ISODate): ForecastResult {
  const cur = forecastEndOfMonth(data, todayISO)
  const month = addMonths(monthKey(todayISO), 1)
  const from = monthStart(month)
  const to = monthEnd(month)
  const incomes = expectedIncomeUntil(data, to, todayISO).filter((i) => i.date >= from)
  const obligations = obligationsUntil(data, to, todayISO).filter((o) => o.date >= from)
  const budget = buildBudget(data, todayISO)
  const income = incomes.reduce((s, i) => s + i.amount, 0)
  const known = obligations.reduce((s, o) => s + o.amount, 0)
  const variable = budget.plan.variableUsual
  const endBal = cur.end + income - known - variable
  return {
    month,
    start: cur.end,
    startLabel: 'Прогноз на начало месяца',
    income,
    incomes,
    known,
    obligations,
    variable,
    end: endBal,
    endFree: endBal - reservedAmount(data, to),
    confidence: 'low',
    notes: ['Переменные траты — обычный месячный уровень', 'Не учитывает траты, которые ещё не введены'],
  }
}
