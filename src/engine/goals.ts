import { monthKey, monthsBetween } from './dates'
import type { AppData, Cents, Debt, Goal, ISODate } from './types'

export interface GoalProgress {
  goal: Goal
  remaining: Cents
  progress: number // 0..1
  monthsLeft: number | null
  /** Сколько нужно откладывать в месяц, чтобы успеть к дате */
  monthlyRequired: Cents | null
  overdue: boolean
}

export function goalProgress(goal: Goal, todayISO: ISODate): GoalProgress {
  const remaining = Math.max(goal.target - goal.current, 0)
  const progress = goal.target > 0 ? Math.min(goal.current / goal.target, 1) : 0
  if (!goal.targetDate) return { goal, remaining, progress, monthsLeft: null, monthlyRequired: null, overdue: false }
  // считаем целые месяцы до даты цели; текущий месяц тоже можно использовать для откладывания
  const monthsLeft = Math.max(monthsBetween(monthKey(todayISO), monthKey(goal.targetDate)), 0)
  const overdue = goal.targetDate < todayISO && remaining > 0
  // взнос считается от остатка на начало месяца, чтобы план не «плыл» после пополнения в этом же месяце
  const remainingAtMonthStart = Math.min(remaining + contributedInMonth(goal, monthKey(todayISO)), goal.target)
  const monthlyRequired = remainingAtMonthStart === 0 ? 0 : Math.ceil(remainingAtMonthStart / Math.max(monthsLeft, 1))
  return { goal, remaining, progress, monthsLeft, monthlyRequired, overdue }
}

/** Сколько отложено на цель в месяце m */
export function contributedInMonth(goal: Goal, m: string): Cents {
  return (goal.contributions ?? []).filter((c) => c.date.startsWith(m)).reduce((s, c) => s + c.amount, 0)
}

/** Сумма ежемесячных взносов по всем целям с датой */
export function goalsMonthlyRequired(data: AppData, todayISO: ISODate): Cents {
  return data.goals.reduce((s, g) => s + (goalProgress(g, todayISO).monthlyRequired ?? 0), 0)
}

export interface DebtStatus {
  debt: Debt
  paid: Cents
  remaining: Cents | null
  nextPayments: { date: ISODate; amount: Cents; kind: 'удержание' | 'платёж' }[]
  finalDate: ISODate | null
}

/** Остаток долга = всего к возврату − прошедшие удержания − проведённые платежи с debtId */
export function debtStatus(data: AppData, debt: Debt, todayISO: ISODate): DebtStatus {
  const deducted = debt.deductions.filter((d) => d.date <= todayISO).reduce((s, d) => s + d.amount, 0)
  const txs = data.transactions.filter((t) => t.debtId === debt.id)
  const paidTx = txs.filter((t) => t.status === 'posted').reduce((s, t) => s + t.amount, 0)
  const paid = deducted + paidTx
  const next = [
    ...debt.deductions.filter((d) => d.date > todayISO).map((d) => ({ date: d.date, amount: d.amount, kind: 'удержание' as const })),
    ...txs.filter((t) => t.status !== 'posted').map((t) => ({ date: t.date, amount: t.amount, kind: 'платёж' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  return {
    debt,
    paid,
    remaining: debt.totalToRepay === null ? null : Math.max(debt.totalToRepay - paid, 0),
    nextPayments: next,
    finalDate: next.length ? next[next.length - 1].date : null,
  }
}
