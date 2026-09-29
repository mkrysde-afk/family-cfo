import { availableToSpend } from './available'
import { buildBudget } from './budget'
import { daysInMonth, formatDate, monthKey, monthName, parseISO } from './dates'
import { debtStatus, goalProgress } from './goals'
import { emergencyFund } from './health'
import { eur, median } from './money'
import { annualCost, dueOccurrences, isActiveAround } from './recurring'
import { dataMonths, monthCoverageRatio, monthTotals } from './stats'
import type { AppData, Cents, Confidence, ISODate } from './types'

export type Severity = 'critical' | 'warning' | 'info' | 'good'

/** Каждый вывод CFO: ЧТО → ПОЧЕМУ → ЧТО СДЕЛАТЬ → ОЖИДАЕМЫЙ ЭФФЕКТ */
export interface Insight {
  id: string
  severity: Severity
  title: string
  what: string
  why: string
  action: string
  effect: string
  confidence: Confidence
  /** денежный эффект в месяц (для сортировки) */
  impact: Cents
  categoryId?: string
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 }
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
const pct = (a: number, b: number) => Math.round((a / Math.max(b, 1)) * 100)

export function cfoInsights(data: AppData, todayISO: ISODate): Insight[] {
  const out: Insight[] = []
  const month = monthKey(todayISO)
  const budget = buildBudget(data, todayISO)
  const plan = budget.plan
  const catById = (id: string) => data.categories.find((c) => c.id === id)
  const histConf: Confidence = plan.months.length >= 5 ? 'high' : plan.months.length >= 3 ? 'medium' : 'low'

  // 1. Структурный денежный поток
  if (plan.months.length > 0) {
    const bal = plan.balanceAtUsual
    const cutters = budget.rows.filter((r) => r.cut > 0).sort((a, b) => b.cut - a.cut).slice(0, 4)
    if (bal < 0) {
      out.push({
        id: 'cashflow-deficit',
        severity: 'critical',
        title: `При обычных тратах минус ${eur(-bal)} в месяц`,
        what: `Обычные расходы семьи больше ожидаемого дохода на ${eur(-bal)} в месяц.`,
        why: `Доход ${eur(plan.income)} (регулярные поступления) − обязательные платежи ${eur(plan.fixed)} − обычные переменные траты ${eur(plan.variableUsual)} (медиана за ${plan.months.length} мес.) = ${eur(bal)}.`,
        action: cutters.length
          ? `Сократить переменные траты на ${eur(plan.cutAchievable)}: ${cutters.map((r) => `${r.category.name} −${eur(r.cut)}`).join(', ')}.`
          : 'Пересмотреть обязательные платежи или увеличить доход — переменных трат для сокращения недостаточно.',
        effect:
          plan.cutAchievable >= plan.cutNeeded
            ? `Выход в ноль и ${eur(plan.savingsTarget + plan.goalsMonthly)} в месяц на цели и накопления.`
            : `Дефицит уменьшится до ${eur(plan.cutNeeded - plan.cutAchievable)} в месяц; остальное — только через доход или обязательные платежи.`,
        confidence: histConf,
        impact: -bal,
      })
    } else {
      out.push({
        id: 'cashflow-ok',
        severity: plan.cutNeeded > 0 ? 'warning' : 'good',
        title: plan.cutNeeded > 0 ? `Запас ${eur(bal)}, но на цели не хватает ${eur(plan.cutNeeded)}` : `Запас ${eur(bal)} в месяц`,
        what: `При обычных тратах в месяц остаётся ${eur(bal)}.`,
        why: `Доход ${eur(plan.income)} − обязательные ${eur(plan.fixed)} − переменные ${eur(plan.variableUsual)}.`,
        action: plan.cutNeeded > 0 ? `Для целей (${eur(plan.savingsTarget + plan.goalsMonthly)}/мес) сократить переменные траты на ${eur(plan.cutNeeded)}.` : `Переводить ${eur(Math.min(bal, plan.savingsTarget + plan.goalsMonthly) || bal)} в накопления сразу после зарплаты.`,
        effect: `${eur(bal * 12)} в год при сохранении уровня трат.`,
        confidence: histConf,
        impact: bal,
      })
    }
  }

  // 2. «Можно потратить» и дневной лимит
  const av = availableToSpend(data, todayISO)
  const dim = daysInMonth(month)
  const daysLeft = dim - parseISO(todayISO).getDate() + 1
  if (av.available < 0) {
    out.push({
      id: 'available-negative',
      severity: 'critical',
      title: `До конца месяца не хватает ${eur(-av.available)}`,
      what: `После обязательных платежей и отложенного на цели свободных денег нет: ${eur(av.available)}.`,
      why: `На счетах ${eur(av.spendable)}, ожидают списания ${eur(av.pending)}, платежи до ${formatDate(av.horizon)} — ${eur(av.upcoming)}, отложено на цели ${eur(av.reserved)}.`,
      action: 'Отложить необязательные покупки до поступления дохода; проверить, какие платежи можно перенести.',
      effect: av.expectedIncome > 0 ? `Ожидаемые поступления ${eur(av.expectedIncome)} закроют разрыв, если придут вовремя.` : 'Без дополнительного дохода разрыв сохранится.',
      confidence: 'high',
      impact: -av.available,
    })
  } else if (daysLeft > 0) {
    out.push({
      id: 'daily-limit',
      severity: 'info',
      title: `≈ ${eur(Math.floor(av.available / daysLeft))} в день до конца месяца`,
      what: `Свободно ${eur(av.available)} на ${daysLeft} дн.`,
      why: 'Из денег на счетах уже вычтены ожидающие списания, регулярные платежи до конца месяца и отложенное на цели.',
      action: `Держать траты в пределах ${eur(Math.floor(av.available / daysLeft))} в день.`,
      effect: 'Месяц закроется без использования накоплений.',
      confidence: 'high',
      impact: 0,
    })
  }

  // 3. Отклонения по категориям
  const curCov = monthCoverageRatio(data, month, todayISO)
  const useCurrent = curCov >= 0.9 && parseISO(todayISO).getDate() >= 5
  const refMonth = useCurrent ? month : plan.months[0]
  if (refMonth) {
    const totals = useCurrent ? monthTotals(data, month, todayISO) : monthTotals(data, refMonth)
    const frac = useCurrent ? parseISO(todayISO).getDate() / dim : 1
    for (const row of budget.rows) {
      const c = row.category
      if (c.essential) continue
      const actual = totals.byCategory[c.id] ?? 0
      const usual = row.usual
      if (usual < 3000) continue
      const expected = usual * frac
      const over = actual - expected
      if (over >= 4000 && actual >= usual * frac * 1.2) {
        const periodTxt = useCurrent ? `за ${parseISO(todayISO).getDate()} дн. этого месяца` : `за ${monthName(refMonth).toLowerCase()}`
        const extra = useCurrent ? Math.max(actual - usual, 0) : over
        out.push({
          id: `over-${c.id}`,
          severity: 'warning',
          title: `${c.name}: на ${pct(actual - expected, expected)}% выше обычного`,
          what: `${c.name} ${periodTxt}: ${eur(actual)} при обычном уровне ${eur(Math.round(expected))}${useCurrent ? ' на эту дату' : ''}.`,
          why: `Обычный уровень — медиана за ${plan.months.length} мес.: ${eur(usual)} в месяц.`,
          action: useCurrent ? `До конца месяца удержать ${c.name.toLowerCase()} в пределах ${eur(Math.max(usual - actual, 0))}.` : `Вернуть ${c.name.toLowerCase()} к обычным ${eur(usual)} в месяц.`,
          effect: `≈ +${eur(Math.round(useCurrent ? Math.max(over, extra) : over))} в месяц к результату${plan.balanceAtUsual < 0 ? ' (уменьшит дефицит)' : ''}.`,
          confidence: histConf,
          impact: Math.round(over),
          categoryId: c.id,
        })
      }
    }
  }

  // 4. Тренд: последние 3 месяца против трёх предыдущих
  const six = dataMonths(data, month, 6)
  if (six.length === 6) {
    const recent = six.slice(0, 3).map((m) => monthTotals(data, m))
    const before = six.slice(3).map((m) => monthTotals(data, m))
    for (const row of budget.rows) {
      const c = row.category
      if (c.essential) continue
      const r = median(recent.map((t) => t.byCategory[c.id] ?? 0))
      const b = median(before.map((t) => t.byCategory[c.id] ?? 0))
      if (r - b >= 5000 && r >= b * 1.3 && !out.some((i) => i.id === `over-${c.id}`)) {
        out.push({
          id: `trend-${c.id}`,
          severity: 'warning',
          title: `${c.name}: растёт третий месяц`,
          what: `${c.name} за последние 3 мес. — ${eur(r)} в месяц против ${eur(b)} раньше (+${pct(r - b, b)}%).`,
          why: `Медиана ${monthName(six[2], false).toLowerCase()}–${monthName(six[0], false).toLowerCase()} против ${monthName(six[5], false).toLowerCase()}–${monthName(six[3], false).toLowerCase()}.`,
          action: `Вернуться к уровню ${eur(b)} в месяц.`,
          effect: `≈ +${eur(r - b)} в месяц, ${eur((r - b) * 12)} в год.`,
          confidence: 'medium',
          impact: r - b,
          categoryId: c.id,
        })
      }
    }
  }

  // 5. Наличные без детализации
  const cashCat = data.categories.find((c) => c.id === 'cash-untracked')
  if (cashCat) {
    const cashUsual = budget.usual.byCategory[cashCat.id] ?? 0
    const share = cashUsual / Math.max(budget.usual.expense, 1)
    if (cashUsual > 0 && share >= 0.08) {
      out.push({
        id: 'cash-blind',
        severity: 'warning',
        title: `${pct(cashUsual, budget.usual.expense)}% расходов — наличные без учёта`,
        what: `В обычный месяц ${eur(cashUsual)} снимается наличными, и неизвестно, на что они уходят.`,
        why: 'В выписке видно только снятие в банкомате. Это слепая зона: здесь нельзя найти экономию.',
        action: 'Снятие вносить как перевод «Банк → Наличные», а траты наличными — как обычные расходы с категорией.',
        effect: 'Рекомендации станут точнее; обычно в «невидимых» наличных находится 10–20% экономии.',
        confidence: 'high',
        impact: Math.round(cashUsual * 0.1),
        categoryId: cashCat.id,
      })
    }
  }

  // 6. Долги с крупным итоговым платежом
  for (const d of data.debts) {
    const st = debtStatus(data, d, todayISO)
    const lump = st.nextPayments.filter((p) => p.kind === 'платёж').sort((a, b) => b.amount - a.amount)[0]
    if (!lump) continue
    const goal = data.goals.find((g) => g.reserve && g.targetDate && Math.abs(g.target - lump.amount) < 100)
    const gp = goal ? goalProgress(goal, todayISO) : null
    out.push({
      id: `debt-${d.id}`,
      severity: gp && gp.remaining > 0 ? 'warning' : 'info',
      title: `${formatDate(lump.date, true)}: платёж ${eur(lump.amount)} — ${d.name}`,
      what: `Осталось вернуть ${st.remaining === null ? 'неизвестно сколько' : eur(st.remaining)}; крупный платёж ${eur(lump.amount)} ${formatDate(lump.date, true)}.`,
      why: `Удержания из зарплаты покрывают только часть; итоговый платёж нужно оплатить со счёта.${d.interestRate === null ? ' Процентная ставка: недостаточно данных.' : ''}`,
      action: gp ? `Откладывать ${eur(gp.monthlyRequired ?? 0)} в месяц (сейчас отложено ${eur(goal!.current)} из ${eur(goal!.target)}).` : `Создать цель на ${eur(lump.amount)} к ${formatDate(lump.date, true)}.`,
      effect: 'Платёж не ударит по бюджету одного месяца.',
      confidence: d.confidence,
      impact: gp?.monthlyRequired ?? 0,
    })
  }

  // 7. Подушка безопасности
  const ef = emergencyFund(data, todayISO)
  if (ef.essentialMonthly > 0 && ef.months < 3) {
    out.push({
      id: 'emergency',
      severity: ef.months < 1 ? 'warning' : 'info',
      title: `Подушка: ${ef.months.toFixed(1).replace('.', ',')} мес. вместо 3`,
      what: `В накоплениях ${eur(ef.current)} — это ${ef.months.toFixed(1).replace('.', ',')} мес. обязательных расходов (${eur(ef.essentialMonthly)}/мес).`,
      why: 'Без подушки любой ремонт машины или пропущенная зарплата уходит в минус.',
      action: plan.balanceAtUsual < 0 ? 'Сначала выйти в ноль, затем откладывать на подушку.' : `Откладывать ${eur(Math.ceil(ef.need3 / 12))} в месяц — 3 месяца расходов накопятся за год.`,
      effect: `Цель 3 мес.: ${eur(ef.target3)} (не хватает ${eur(ef.need3)}); 6 мес.: ${eur(ef.target6)}.`,
      confidence: ef.confidence,
      impact: 0,
    })
  }

  // 8. Подписки
  const subs = data.recurring.filter((r) => isActiveAround(r, month) && r.subscription)
  if (subs.length) {
    const yearly = subs.reduce((s, r) => s + annualCost(r), 0)
    out.push({
      id: 'subscriptions',
      severity: 'info',
      title: `Подписки: ${eur(yearly)} в год`,
      what: `${subs.length} ${plural(subs.length, 'подписка', 'подписки', 'подписок')}: ${subs.map((s) => s.name).join(', ')}.`,
      why: 'Небольшие регулярные списания незаметны, но складываются в годовую сумму.',
      action: 'Раз в квартал проверять, какие подписки реально используются.',
      effect: `Каждая отменённая подписка — её сумма × 12 в год.`,
      confidence: 'high',
      impact: 0,
    })
  }

  // 9. Ожидают подтверждения
  const due = dueOccurrences(data, todayISO)
  if (due.length) {
    out.push({
      id: 'due',
      severity: 'info',
      title: `${due.length} ${plural(due.length, 'платёж ждёт', 'платежа ждут', 'платежей ждут')} подтверждения`,
      what: due.slice(0, 4).map((o) => `${o.recurring.name} ${eur(o.recurring.amount)}`).join(', ') + (due.length > 4 ? '…' : ''),
      why: 'Дата платежа наступила; пока он не подтверждён, сумма вычитается из «Можно потратить» как ожидаемая.',
      action: 'Проверить в банке, что списание прошло, и подтвердить в разделе «Операции».',
      effect: 'Балансы и прогноз станут точными.',
      confidence: 'high',
      impact: 0,
    })
  }

  // 10. Крупные разовые траты последнего полного месяца
  const last = plan.months[0]
  if (last) {
    const big = data.transactions.filter((t) => t.type === 'expense' && t.status === 'posted' && !t.recurringId && monthKey(t.date) === last && t.amount >= 30000 && catById(t.categoryId ?? '')?.id !== 'housing')
    if (big.length) {
      const s = big.reduce((a, t) => a + t.amount, 0)
      out.push({
        id: 'big-oneoff',
        severity: 'info',
        title: `Крупные разовые траты за ${monthName(last).toLowerCase()}: ${eur(s)}`,
        what: big.map((t) => `${t.description} ${eur(t.amount)}`).join('; '),
        why: 'Разовые траты не входят в «обычный» уровень (используется медиана), но уменьшают деньги на счетах.',
        action: 'Крупные покупки планировать как цель и копить заранее.',
        effect: 'Меньше провалов баланса в отдельные месяцы.',
        confidence: 'high',
        impact: 0,
      })
    }
  }

  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.impact - a.impact)
}

/** Потенциальная экономия по необязательным категориям */
export interface DiscretionaryRow {
  categoryId: string
  name: string
  thisMonth: Cents
  usual: Cents
  potential: Cents
}

export function discretionaryRows(data: AppData, todayISO: ISODate): DiscretionaryRow[] {
  const b = buildBudget(data, todayISO)
  return b.rows
    .filter((r) => !r.category.essential && r.usual > 0)
    .map((r) => ({
      categoryId: r.category.id,
      name: r.category.name,
      thisMonth: r.actual,
      usual: r.usual,
      potential: Math.max(r.cut, Math.max(r.actual - r.usual, 0)),
    }))
    .sort((a, b) => b.usual - a.usual)
}
