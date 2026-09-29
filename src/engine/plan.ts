import { monthKey, type MonthKey } from './dates'
import { goalsMonthlyRequired } from './goals'
import { savingsMoney } from './balances'
import { median } from './money'
import { isActiveAround, monthlyEquivalent } from './recurring'
import { dataMonths, monthTotals } from './stats'
import type { AppData, Category, Cents, ISODate } from './types'

/** Доля дохода в подушку по умолчанию и минимум, если денег впритык */
export const CUSHION_RATE = 0.1
export const CUSHION_MIN_RATE = 0.05
/** Необходимое планируется чуть ниже привычного уровня — реалистичная цель экономии */
export const NEED_FACTOR = 0.9
/** Минимальный осмысленный конверт */
export const MIN_ENVELOPE = 500

export interface Envelope {
  category: Category
  kind: 'need' | 'want'
  /** привычный месячный уровень (медиана), с учётом объединённых категорий */
  habit: Cents
  /** лимит на месяц */
  limit: Cents
  overridden: boolean
}

export interface MoneyPlan {
  month: MonthKey
  income: Cents
  /** регулярные обязательные платежи */
  fixed: Cents
  /** взносы на цели с датой (например, долг 1 700 €) */
  goals: Cents
  /** свободные деньги = доход − обязательные − взносы на цели */
  free: Cents
  /** в подушку по правилу (до распределения остатка) */
  cushion: Cents
  cushionRule: 'manual' | 'auto' | 'auto-min' | 'none'
  envelopes: Envelope[]
  needs: Cents
  wants: Cents
  /** не распределено по конвертам — тоже в подушку */
  extra: Cents
  /** итого в подушку в этом месяце */
  cushionTotal: Cents
  /** план не сходится на эту сумму */
  shortfall: Cents
  months: MonthKey[]
}

/** Категории, чья история объединяется с категорией c (включая её саму) */
function mergedIds(data: AppData, c: Category): string[] {
  return [c.id, ...data.categories.filter((x) => x.mergeInto === c.id).map((x) => x.id)]
}

/**
 * План месяца «как у финансового консультанта» — сначала платим себе, потом тратим:
 * 1. свободные деньги = доход − обязательные платежи − взносы на цели (долг);
 * 2. подушка: вручную заданная сумма, иначе 10% дохода (не меньше 5%, если впритык);
 * 3. необходимое (need) получает реалистичный минимум = 90% привычного уровня;
 * 4. желания (want) делят остаток пропорционально привычке, но не больше привычного уровня;
 * 5. всё, что не распределено, — дополнительно в подушку;
 * 6. ручные лимиты пользователя перекрывают расчёт.
 */
export function moneyPlan(data: AppData, todayISO: ISODate, month: MonthKey = monthKey(todayISO)): MoneyPlan {
  const months = dataMonths(data, month, 6)
  const totals = months.map((m) => monthTotals(data, m))
  const income = data.recurring.filter((r) => isActiveAround(r, month) && r.type === 'income').reduce((s, r) => s + monthlyEquivalent(r), 0)
    || median(totals.map((t) => t.income))
  const fixed = data.recurring.filter((r) => isActiveAround(r, month) && r.type === 'expense').reduce((s, r) => s + monthlyEquivalent(r), 0)
  const goals = goalsMonthlyRequired(data, todayISO)
  const free = income - fixed - goals

  const cats = data.categories.filter((c) => c.envelope && !c.archived)
  const habit = (c: Category) => {
    const ids = mergedIds(data, c)
    return median(totals.map((t) => ids.reduce((s, id) => s + (t.variableByCategory[id] ?? 0), 0)))
  }
  const needs = cats.filter((c) => c.envelope === 'need').map((c) => ({ c, habit: habit(c) }))
  const wants = cats.filter((c) => c.envelope === 'want').map((c) => ({ c, habit: habit(c) }))
  const needBase = needs.map((n) => ({ ...n, base: Math.round(n.habit * NEED_FACTOR) }))
  const needSum = needBase.reduce((s, n) => s + n.base, 0)

  // Подушка
  const manual = data.settings.savingsTarget > 0
  let cushion: Cents
  let cushionRule: MoneyPlan['cushionRule']
  if (free <= 0) {
    cushion = 0
    cushionRule = 'none'
  } else if (manual) {
    cushion = Math.min(data.settings.savingsTarget, free)
    cushionRule = 'manual'
  } else {
    // когда подушка уже на 6 месяцев — достаточно поддерживать её минимальным взносом
    const cushionNow = savingsMoney(data, todayISO) + data.goals.filter((g) => g.emergency).reduce((s, g) => s + g.current, 0)
    const rate = fixed + needSum > 0 && cushionNow / (fixed + needSum) >= 6 ? CUSHION_MIN_RATE : CUSHION_RATE
    cushion = Math.round(income * rate)
    cushionRule = 'auto'
    if (free - cushion < needSum) {
      cushion = Math.max(Math.round(income * CUSHION_MIN_RATE), free - needSum)
      cushionRule = 'auto-min'
    }
    cushion = Math.max(Math.min(cushion, free), 0)
  }

  // Необходимое
  const forNeeds = Math.max(free - cushion, 0)
  const needScale = needSum > forNeeds && needSum > 0 ? forNeeds / needSum : 1
  const envelopes: Envelope[] = needBase.map((n) => ({ category: n.c, kind: 'need', habit: n.habit, limit: Math.floor(n.base * needScale), overridden: false }))

  // Желания
  const wantsPool = Math.max(forNeeds - envelopes.reduce((s, e) => s + e.limit, 0), 0)
  const wantsHabit = wants.reduce((s, w) => s + w.habit, 0)
  const wantScale = wantsHabit > wantsPool && wantsHabit > 0 ? wantsPool / wantsHabit : 1
  for (const w of wants) {
    const limit = Math.floor(w.habit * wantScale)
    // конверт меньше 5 € не имеет смысла — эти деньги уходят в подушку
    envelopes.push({ category: w.c, kind: 'want', habit: w.habit, limit: limit < MIN_ENVELOPE ? 0 : limit, overridden: false })
  }

  // Ручные лимиты
  const ov = data.settings.envelopeOverrides ?? {}
  for (const e of envelopes) {
    if (ov[e.category.id] !== undefined) {
      e.limit = ov[e.category.id]
      e.overridden = true
    }
  }

  const needsTotal = envelopes.filter((e) => e.kind === 'need').reduce((s, e) => s + e.limit, 0)
  const wantsTotal = envelopes.filter((e) => e.kind === 'want').reduce((s, e) => s + e.limit, 0)
  const rest = free - cushion - needsTotal - wantsTotal
  return {
    month,
    income,
    fixed,
    goals,
    free,
    cushion,
    cushionRule,
    envelopes: envelopes.filter((e) => e.limit > 0 || e.overridden || e.habit >= MIN_ENVELOPE).sort((a, b) => (a.kind === b.kind ? b.limit - a.limit : a.kind === 'need' ? -1 : 1)),
    needs: needsTotal,
    wants: wantsTotal,
    extra: Math.max(rest, 0),
    cushionTotal: cushion + Math.max(rest, 0),
    shortfall: Math.max(-rest, 0),
    months,
  }
}
