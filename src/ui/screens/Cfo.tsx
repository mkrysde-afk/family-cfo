import { useMemo } from 'react'
import {
  annualCost,
  buildBudget,
  cfoInsights,
  dataMonths,
  discretionaryRows,
  eur,
  FREQ_LABEL,
  financialHealth,
  isActiveAround,
  monthKey,
  monthName,
  monthTotals,
  type Insight,
} from '../../engine'
import { useData, useStore } from '../../state/store'
import { Bar, ConfBadge, MonthBars, ScoreRing, useLookups } from '../components/common'

const SEV_LABEL: Record<Insight['severity'], string> = { critical: 'Критично', warning: 'Внимание', info: 'К сведению', good: 'Хорошо' }
const SEV_BADGE: Record<Insight['severity'], string> = { critical: 'bad', warning: 'warn', info: 'accent', good: 'good' }

export function InsightCard({ i }: { i: Insight }) {
  return (
    <div className={`card insight sev-${i.severity}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="card-title grow">{i.title}</span>
      </div>
      <div className="row wrap" style={{ justifyContent: 'flex-start', gap: 6, marginTop: 6 }}>
        <span className={`badge ${SEV_BADGE[i.severity]}`}>{SEV_LABEL[i.severity]}</span>
        <ConfBadge c={i.confidence} />
      </div>
      <dl className="kv">
        <dt>Что</dt><dd>{i.what}</dd>
        <dt>Почему</dt><dd>{i.why}</dd>
        <dt>Что сделать</dt><dd>{i.action}</dd>
        <dt>Эффект</dt><dd className="good">{i.effect}</dd>
      </dl>
    </div>
  )
}

export function Cfo() {
  const data = useData()
  const { today } = useStore()
  const { cat } = useLookups(data)
  const health = useMemo(() => financialHealth(data, today), [data, today])
  const insights = useMemo(() => cfoInsights(data, today), [data, today])
  const disc = useMemo(() => discretionaryRows(data, today), [data, today])
  const budget = useMemo(() => buildBudget(data, today), [data, today])
  const months = useMemo(() => dataMonths(data, monthKey(today), 6).reverse(), [data, today])
  const monthly = months.map((m) => monthTotals(data, m))
  const recurring = data.recurring.filter((r) => isActiveAround(r, monthKey(today)) && r.type === 'expense').sort((a, b) => annualCost(b) - annualCost(a))
  const p = budget.plan

  return (
    <>
      <h1 className="page-title">CFO</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: 'flex-start', gap: 16 }}>
          <ScoreRing score={health.score} />
          <div>
            <div className="card-title">{health.status}</div>
            <div className="small muted">Индекс финансовой устойчивости из 100</div>
          </div>
        </div>
        <div className="stack" style={{ marginTop: 14 }}>
          {health.components.map((c) => (
            <div key={c.key}>
              <div className="row small"><span>{c.label}</span><span className="num muted">{Math.round(c.score)} / {c.max}</span></div>
              <Bar value={c.score} max={c.max} color={c.score / c.max >= 0.7 ? 'var(--good)' : c.score / c.max >= 0.4 ? 'var(--warn)' : 'var(--bad)'} />
              <div className="tiny muted" style={{ marginTop: 2 }}>{c.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Месяц в среднем</div>
        <div className="small muted" style={{ marginBottom: 8 }}>Доход — по регулярным поступлениям</div>
        <div className="row"><span className="muted">Доход</span><span className="num good">{eur(p.income)}</span></div>
        <div className="row"><span className="muted">Обязательные платежи</span><span className="num">−{eur(p.fixed)}</span></div>
        <div className="row"><span className="muted">Обычные переменные траты</span><span className="num">−{eur(p.variableUsual)}</span></div>
        <div className="divider" />
        <div className="row"><b>Результат месяца</b><b className={`num ${p.balanceAtUsual < 0 ? 'bad' : 'good'}`}>{eur(p.balanceAtUsual, { sign: true })}</b></div>
        {p.goalsMonthly > 0 && <div className="row small"><span className="muted">Нужно на цели</span><span className="num">{eur(p.goalsMonthly)}/мес</span></div>}
        <p className="tiny muted" style={{ marginBottom: 0 }}>Переменные траты — среднее за {p.months.length} мес. без разовых крупных покупок.</p>
      </div>

      <div className="section-title">Выводы и рекомендации</div>
      {insights.length === 0 && <div className="card empty">Недостаточно данных для выводов.</div>}
      {insights.map((i) => <InsightCard key={i.id} i={i} />)}

      {monthly.length > 1 && (
        <>
          <div className="section-title">Доходы и расходы по месяцам</div>
          <div className="card">
            <MonthBars items={monthly.flatMap((t) => [{ label: monthName(t.month, false).slice(0, 3), value: t.expense, color: 'var(--text-3)' }])} />
            <div className="stack small" style={{ marginTop: 8 }}>
              {monthly.map((t) => (
                <div className="row" key={t.month}>
                  <span className="muted">{monthName(t.month)}</span>
                  <span className="num"><span className="good">{eur(t.income)}</span> · {eur(t.expense)} · <b className={t.income - t.expense < 0 ? 'bad' : 'good'}>{eur(t.income - t.expense, { sign: true })}</b></span>
                </div>
              ))}
            </div>
            <p className="tiny muted" style={{ marginBottom: 0 }}>доход · расход · итог. Переводы между своими счетами не учитываются.</p>
          </div>
        </>
      )}

      <div className="section-title">Где можно сэкономить</div>
      <div className="card">
        {disc.length === 0 ? (
          <div className="empty">Недостаточно данных.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr className="muted small"><th style={{ textAlign: 'left', fontWeight: 500 }}>Категория</th><th style={{ textAlign: 'right', fontWeight: 500 }}>Этот мес.</th><th style={{ textAlign: 'right', fontWeight: 500 }}>Обычно</th><th style={{ textAlign: 'right', fontWeight: 500 }}>Резерв</th></tr>
            </thead>
            <tbody>
              {disc.map((r) => (
                <tr key={r.categoryId}>
                  <td style={{ padding: '6px 0' }}><span className="dot" style={{ display: 'inline-block', marginRight: 6, background: cat(r.categoryId)?.color }} />{r.name}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{eur(r.thisMonth)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{eur(r.usual)}</td>
                  <td className={`num ${r.potential > 0 ? 'good' : 'faint'}`} style={{ textAlign: 'right' }}>{r.potential > 0 ? eur(r.potential) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="tiny muted" style={{ marginBottom: 0 }}>Резерв — реалистичное сокращение (не больше 35% переменной части) или превышение обычного уровня в этом месяце. Оценивается категория, а не отдельные покупки.</p>
      </div>

      <div className="section-title">Регулярные платежи</div>
      <div className="list">
        {recurring.map((r) => (
          <div className="list-item" key={r.id}>
            <span className="dot" style={{ background: cat(r.categoryId)?.color }} />
            <div className="grow">
              <div className="title ellipsis">{r.name}{r.subscription && <span className="badge accent" style={{ marginLeft: 6 }}>подписка</span>}</div>
              <div className="sub">{eur(r.amount, { cents: true })} {FREQ_LABEL[r.frequency]} · ≈ {eur(annualCost(r))} в год</div>
            </div>
            <ConfBadge c={r.confidence} short />
          </div>
        ))}
      </div>
    </>
  )
}
