import { useMemo, useState } from 'react'
import {
  allowances,
  contributedInMonth,
  parseAmount,
  availableToSpend,
  dataMonths,
  emergencyFund,
  eur,
  forecastEndOfMonth,
  forecastNextMonth,
  formatDate,
  monthCoverageRatio,
  monthEnd,
  monthKey,
  monthName,
  monthTotals,
  addMonths,
  whatChanged,
  type MonthKey,
} from '../../engine'
import { useData, useStore } from '../../state/store'
import { Bar, Donut, Money, useLookups, useToast } from '../components/common'
import type { Route } from '../App'

/** Подробный обзор месяца (бывший главный экран) — показывается на вкладке CFO */
export function MonthOverview({ go }: { go: (r: Route) => void }) {
  const data = useData()
  const { today } = useStore()
  const { cat } = useLookups(data)
  const [showCalc, setShowCalc] = useState(false)

  const av = useMemo(() => availableToSpend(data, today), [data, today])
  const plan = useMemo(() => allowances(data, today), [data, today])
  const { contributeGoal, limited } = useStore()
  const toast = useToast()
  const curMonth = monthKey(today)
  const debtGoal = data.goals.find((g) => g.debtId)
  const cushionGoal = data.goals.find((g) => g.emergency)
  const savingsRows = [
    { id: 'cushion', label: 'В подушку', goal: cushionGoal, target: plan.plan.cushionTotal, done: cushionGoal ? contributedInMonth(cushionGoal, curMonth) : 0 },
    ...(debtGoal ? [{ id: 'debt', label: debtGoal.name, goal: debtGoal, target: plan.plan.goals, done: contributedInMonth(debtGoal, curMonth) }] : []),
  ].filter((r) => r.target > 0)
  function setAside(id: string, amount: number, label: string) {
    const input = prompt(`Сколько отложить («${label}»), €?`, (amount / 100).toFixed(2).replace('.', ','))
    if (input === null) return
    const v = parseAmount(input)
    if (!v) return toast('Неверная сумма')
    contributeGoal(id, v)
    toast(`Отложено ${eur(v)} — вычтено из «Можно потратить»`)
  }
  const eom = useMemo(() => forecastEndOfMonth(data, today), [data, today])
  const next = useMemo(() => forecastNextMonth(data, today), [data, today])
  const ef = useMemo(() => emergencyFund(data, today), [data, today])
  const changed = useMemo(() => whatChanged(data, today), [data, today])

  // Месяц для блока трат: текущий, если в нём есть данные; иначе последний полный
  const cur = monthKey(today)
  const hasCurrent = monthCoverageRatio(data, cur, today) > 0 && monthTotals(data, cur, today).expense > 0
  const defaultMonth: MonthKey = hasCurrent ? cur : (dataMonths(data, cur, 1)[0] ?? cur)
  const [month, setMonth] = useState<MonthKey>(defaultMonth)
  const totals = useMemo(() => monthTotals(data, month, month === cur ? today : undefined), [data, month, cur, today])
  const cats = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])
  const maxCat = cats[0]?.[1] ?? 0
  const daysLeft = Number(eom.month === cur ? new Date(Number(cur.slice(0, 4)), Number(cur.slice(5)), 0).getDate() - Number(today.slice(8)) + 1 : 1)
  const tanyaNoBalance = data.accounts.find((a) => !a.archived && a.balanceConfidence === 'low')

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Как считается общий бюджет</span>
          <button className="linklike small" onClick={() => setShowCalc((v) => !v)}>{showCalc ? 'скрыть' : 'подробно'}</button>
        </div>
        <div className="small muted" style={{ marginBottom: 6 }}>Период: от зарплаты {formatDate(av.cycle.start)} до зарплаты {formatDate(av.cycle.nextPayday)}</div>
        <div className="row"><b>Можно потратить до зарплаты</b><b className={`num ${av.available < 0 ? 'bad' : ''}`}>{eur(av.available)}</b></div>
        {av.available > 0 && daysLeft > 0 && <div className="small muted">≈ {eur(Math.floor(av.available / daysLeft))} в день до конца месяца</div>}
        <div className="divider" />
        <div className="row"><span className="muted">На счетах (без накоплений)</span><Money c={av.spendable} /></div>
        <div className="row"><span className="muted">Ожидает списания</span><Money c={-av.pending} /></div>
        <div className="row"><span className="muted">Платежи до {formatDate(av.horizon)}</span><Money c={-av.upcoming} /></div>
        <div className="row"><span className="muted">Отложено на цели</span><Money c={-av.reserved} /></div>
        {showCalc && (
          <div className="small" style={{ marginTop: 8 }}>
            <div className="divider" />
            {av.obligations.length === 0 && <div className="muted">Известных платежей до конца месяца нет.</div>}
            {av.obligations.map((o, i) => (
              <div className="row" key={i}>
                <span className="muted ellipsis">{formatDate(o.date)} · {o.label}{o.kind === 'pending' ? ' (ожидает)' : ''}</span>
                <Money c={-o.amount} cents />
              </div>
            ))}
            <div className="divider" />
            <div className="muted">
              Будущие доходы не прибавляются: тратим только деньги, которые уже есть. Платежи после дня зарплаты (аренда, школа)
              относятся к следующему периоду — их оплатит новая зарплата.
            </div>
          </div>
        )}
        <div className="divider" />
        <div className="row"><span className="muted">Все деньги семьи</span><Money c={av.total} /></div>
        <div className="row"><span className="muted">Ожидаемый доход до {formatDate(av.horizon)}</span><Money c={av.expectedIncome} /></div>
        <div className="row"><span className="muted">Накопления</span><Money c={av.savings} /></div>
        <div className="row">
          <span className="muted">Финансовая подушка</span>
          <span className="num">{ef.months.toFixed(1).replace('.', ',')} мес. <span className="faint">из 3</span></span>
        </div>
        {tanyaNoBalance && (
          <button className="linklike small" style={{ marginTop: 8 }} onClick={() => go('settings')}>
            Остаток на одной из карт неизвестен — указать
          </button>
        )}
      </div>

      {/* План месяца: сначала себе, потом конверты */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">План на {monthName(plan.plan.month, false).toLowerCase()}</span>
          <button className="linklike small" onClick={() => go('budget')}>изменить</button>
        </div>

        <div className="small muted" style={{ marginBottom: 6 }}>1. Сначала себе</div>
        {savingsRows.map((g) => (
          <div key={g.id} style={{ marginBottom: 10 }}>
            <div className="row small">
              <span className="ellipsis">{g.label}</span>
              <span className="num">{eur(g.done)} из <b>{eur(g.target)}</b></span>
            </div>
            <Bar value={g.done} max={Math.max(g.target, 1)} color="var(--good)" />
            {!limited && g.goal && g.done < g.target && (
              <button className="linklike tiny" style={{ marginTop: 4 }} onClick={() => setAside(g.goal!.id, g.target - g.done, g.label)}>
                Отложить {eur(g.target - g.done)} ›
              </button>
            )}
          </div>
        ))}
        {plan.plan.shortfall > 0 && <p className="small bad" style={{ margin: '0 0 8px' }}>План не сходится на {eur(plan.plan.shortfall)}: уменьшите конверты в «Бюджете».</p>}

        <div className="small muted" style={{ margin: '8px 0 6px' }}>
          2. Конверты до конца месяца · {plan.daysLeft} дн.{plan.prorated ? ' (учёт начат посреди месяца — лимиты на оставшиеся дни)' : ''}
        </div>
        {plan.squeezed && <p className="small warn" style={{ marginTop: 0 }}>Денег на счетах меньше плана — сначала урезаны желания.</p>}
        {plan.rows.length === 0 && <div className="small muted">Конверты появятся, когда будет история трат или вы зададите лимиты в «Бюджете».</div>}
        <div className="stack">
          {(['need', 'want'] as const).map((kind) => {
            const rows = plan.rows.filter((r) => r.kind === kind)
            if (!rows.length) return null
            return (
              <div key={kind} className="stack">
                <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kind === 'need' ? 'Необходимое' : 'Желания'}</div>
                {rows.map((r) => (
                  <div key={r.category.id}>
                    <div className="row small">
                      <span className="ellipsis"><span className="dot" style={{ display: 'inline-block', background: r.category.color, marginRight: 6 }} />{r.category.name}</span>
                      <span className="num">{r.over ? <span className="bad">перерасход {eur(r.overBy)}</span> : <>осталось <b>{eur(r.left)}</b></>}</span>
                    </div>
                    <Bar value={r.spent} max={Math.max(r.spent + r.left, 1)} color={r.over ? 'var(--bad)' : r.category.color} />
                    <div className="tiny faint row" style={{ marginTop: 2 }}>
                      <span>потрачено {eur(r.spent)} · план {eur(r.monthLimit)}/мес</span>
                      {r.left > 0 && <span>≈ {eur(r.perDay)} в день</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <div className="divider" />
        <div className="row small"><span className="muted">Обязательные платежи (аренда, школа, связь…)</span><span className="num" style={{ whiteSpace: 'nowrap' }}>{eur(plan.plan.fixed)}/мес</span></div>
        <div className="tiny muted">Они не входят в конверты и уже вычтены из «Можно потратить».</div>
      </div>

      <div className="grid-2">
        {/* Траты по категориям */}
        <div className="card">
          <div className="card-head">
            <button className="linklike" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
            <span className="card-title">{monthName(month)}</span>
            <button className="linklike" aria-label="Следующий месяц" disabled={month >= cur} style={{ opacity: month >= cur ? 0.3 : 1 }} onClick={() => setMonth(addMonths(month, 1))}>›</button>
          </div>
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <div className="stat"><div className="label">Доходы</div><div className="value good num">{eur(totals.income)}</div></div>
            <div className="stat"><div className="label">Расходы</div><div className="value num">{eur(totals.expense)}</div></div>
            <div className="stat"><div className="label">Итог</div><div className={`value num ${totals.income - totals.expense < 0 ? 'bad' : 'good'}`}>{eur(totals.income - totals.expense, { sign: true })}</div></div>
          </div>
          {monthCoverageRatio(data, month, month === cur ? today : `${month}-28`) < 0.9 && (
            <p className="small warn" style={{ marginTop: 0 }}>
              {month === cur ? `Учёт ведётся с ${formatDate(data.settings.trackingStart)} — данные за месяц неполные.` : 'За этот месяц нет полных данных.'}
            </p>
          )}
          {cats.length === 0 ? (
            <div className="empty">Расходов пока нет. Нажмите «+», чтобы добавить.</div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'center', marginBottom: 12 }}>
                <Donut parts={cats.map(([id, v]) => ({ value: v, color: cat(id)?.color ?? '#999' }))} center={<><span className="tiny muted">расходы</span><b className="num">{eur(totals.expense)}</b></>} />
              </div>
              <div className="stack">
                {cats.slice(0, 7).map(([id, v]) => (
                  <div key={id}>
                    <div className="row small"><span className="ellipsis">{cat(id)?.name ?? id}</span><Money c={v} /></div>
                    <Bar value={v} max={maxCat} color={cat(id)?.color ?? '#999'} />
                  </div>
                ))}
                {cats.length > 7 && <button className="linklike small" onClick={() => go('budget')}>Все категории ›</button>}
              </div>
            </>
          )}
        </div>

        <div>
          {/* Прогноз */}
          <div className="card">
            <div className="card-head"><span className="card-title">Прогноз</span><span className="badge">{eom.confidence === 'medium' ? 'средняя уверенность' : 'низкая уверенность'}</span></div>
            <div className="row"><span className="muted">На {formatDate(monthEnd(eom.month))}</span><b className={`num ${eom.end < 0 ? 'bad' : ''}`}>{eur(eom.end)}</b></div>
            <div className="small muted" style={{ margin: '4px 0 8px' }}>
              {eur(eom.start)} + доход {eur(eom.income)} − платежи {eur(eom.known)} − обычные траты {eur(eom.variable)}
            </div>
            <div className="row"><span className="muted">На {formatDate(monthEnd(next.month))}</span><b className={`num ${next.end < 0 ? 'bad' : ''}`}>{eur(next.end)}</b></div>
            <div className="small muted" style={{ marginTop: 4 }}>
              + доход {eur(next.income)} − платежи {eur(next.known)} − обычные траты {eur(next.variable)}
            </div>
          </div>

          {/* Что изменилось */}
          {changed && (
            <div className="card">
              <div className="card-head"><span className="card-title">Что изменилось</span></div>
              <div className="small muted" style={{ marginTop: -4, marginBottom: 8 }}>{changed.label}: {changed.currentLabel.toLowerCase()} и {changed.previousLabel.toLowerCase()}</div>
              <div className="row"><span className="muted">Доходы</span><Money c={changed.income.delta} sign className={changed.income.delta >= 0 ? 'good' : 'bad'} /></div>
              <div className="row"><span className="muted">Расходы</span><Money c={changed.expense.delta} sign className={changed.expense.delta <= 0 ? 'good' : 'bad'} /></div>
              <div className="row"><span className="muted">Отложено</span><Money c={changed.saved.delta} sign className={changed.saved.delta >= 0 ? 'good' : 'bad'} /></div>
              {changed.available && (
                <div className="row"><span className="muted">Можно потратить (с {formatDate(changed.available.since)})</span><Money c={changed.available.delta} sign className={changed.available.delta >= 0 ? 'good' : 'bad'} /></div>
              )}
              {changed.topCategories.length > 0 && (
                <p className="small" style={{ marginBottom: 0 }}>
                  Главное: {changed.topCategories.map((c) => `${cat(c.categoryId)?.name ?? c.categoryId} ${eur(c.delta, { sign: true })}`).join(', ')}.
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  )
}
