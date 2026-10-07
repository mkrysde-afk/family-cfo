import { useMemo, useState } from 'react'
import { annualCost, buildBudget, eur, isActiveAround, monthKey, monthName, parseAmount } from '../../engine'
import { useData, useStore } from '../../state/store'
import { Bar, useToast } from '../components/common'

export function Budget() {
  const data = useData()
  const { today, updateSettings, limited } = useStore()
  const toast = useToast()
  const b = useMemo(() => buildBudget(data, today), [data, today])
  const m = b.money
  const [target, setTarget] = useState(data.settings.savingsTarget ? String(data.settings.savingsTarget / 100) : '')
  const subs = data.recurring.filter((r) => isActiveAround(r, monthKey(today)) && r.subscription)

  function editEnvelope(id: string, name: string, current: number, overridden: boolean) {
    const input = prompt(`Лимит «${name}» на месяц, €${overridden ? ' (пусто — вернуть расчёт)' : ''}`, (current / 100).toFixed(0))
    if (input === null) return
    const next = { ...(data.settings.envelopeOverrides ?? {}) }
    if (input.trim() === '') delete next[id]
    else {
      const v = input.trim() === '0' ? 0 : parseAmount(input)
      if (v === null) return toast('Неверная сумма')
      next[id] = v
    }
    updateSettings({ envelopeOverrides: next })
    toast('Конверт обновлён')
  }

  function saveTarget() {
    const v = target.trim() === '' ? 0 : parseAmount(target)
    if (v === null) return toast('Неверная сумма')
    updateSettings({ savingsTarget: v })
    toast(v ? `В подушку: ${eur(v)} в месяц` : 'Сумму в подушку считает приложение')
  }

  return (
    <>
      <h1 className="page-title">Бюджет</h1>
      <p className="page-sub">{monthName(monthKey(today))} · «обычно» — медиана за {m.months.length} мес.</p>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>План месяца — сначала себе</div>
        <div className="row"><span className="muted">Ожидаемый доход</span><span className="num good">{eur(m.income)}</span></div>
        <div className="row"><span className="muted">Обязательные платежи</span><span className="num">−{eur(m.fixed)}</span></div>
        <div className="row"><span className="muted">Взносы на цели (долг)</span><span className="num">−{eur(m.goals)}</span></div>
        <div className="row"><b>Свободные деньги</b><b className="num">{eur(m.free)}</b></div>
        <div className="divider" />
        <div className="row"><span>1. В подушку</span><b className="num good">{eur(m.cushionTotal)}</b></div>
        <div className="tiny muted">
          {m.cushionRule === 'manual' ? 'Сумма задана вами' : m.cushionRule === 'auto' ? '10% дохода' : m.cushionRule === 'auto-min' ? 'Денег впритык — сколько остаётся после необходимого (не меньше 5% дохода)' : 'Свободных денег нет'}
          {m.extra > 0 && ` + ${eur(m.extra)} нераспределённого остатка`}
        </div>
        <div className="row" style={{ marginTop: 6 }}><span>2. Необходимое</span><span className="num">{eur(m.needs)}</span></div>
        <div className="row"><span>3. Желания</span><span className="num">{eur(m.wants)}</span></div>
        {m.shortfall > 0 && <p className="small bad" style={{ marginBottom: 0 }}>План не сходится на {eur(m.shortfall)} — уменьшите конверты.</p>}
        {!limited && <div className="divider" />}
        {!limited && <label className="small muted" htmlFor="target">В подушку в месяц, € (пусто — считает приложение)</label>}
        {!limited && <div className="row" style={{ marginTop: 6 }}>
          <input id="target" className="input" inputMode="decimal" placeholder={`авто: ${(m.cushion / 100).toFixed(0)}`} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ''))} />
          <button className="btn small primary" onClick={saveTarget}>Сохранить</button>
        </div>}
      </div>

      <div className="section-title">Конверты на месяц</div>
      <div className="list">
        {m.envelopes.map((e) => (
          <button className="list-item" key={e.category.id} onClick={() => !limited && editEnvelope(e.category.id, e.category.name, e.limit, e.overridden)}>
            <span className="dot" style={{ background: e.category.color }} />
            <div className="grow">
              <div className="title ellipsis">{e.category.name}</div>
              <div className="sub">{e.kind === 'need' ? 'необходимое' : 'желания'} · обычно {eur(e.habit)}{e.overridden ? ' · задано вручную' : ''}</div>
            </div>
            <b className="num">{eur(e.limit)}</b>
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: '-4px 4px 12px' }}>
        Необходимое — 90% обычного уровня. Желания получают остаток после подушки и необходимого, но не больше обычного. Нажмите на конверт, чтобы задать свою сумму.
      </p>

      <div className="section-title">Категории: факт · обычно · рекомендовано</div>
      <div className="card">
        {b.rows.length === 0 && <div className="empty">Недостаточно данных.</div>}
        <div className="stack" style={{ display: 'grid', gap: 14 }}>
          {b.rows.map((r) => {
            const max = Math.max(r.actual, r.usual, r.recommended, 1)
            const vsUsual = r.actual - r.usual
            const vsRec = r.actual - r.recommended
            return (
              <div key={r.category.id}>
                <div className="row">
                  <span className="ellipsis"><span className="dot" style={{ display: 'inline-block', marginRight: 6, background: r.category.color }} />{r.category.name}</span>
                  {r.category.envelope === 'need' ? <span className="badge good">необходимое</span> : r.category.envelope === 'want' ? <span className="badge accent">желания</span> : <span className="badge">обязательное</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 72px', gap: '4px 8px', alignItems: 'center', marginTop: 6 }} className="small">
                  <span className="muted">Факт</span><Bar value={r.actual} max={max} color={r.category.color} marker={r.recommended} /><span className="num" style={{ textAlign: 'right' }}>{eur(r.actual)}</span>
                  <span className="muted">Обычно</span><Bar value={r.usual} max={max} color="var(--text-3)" /><span className="num" style={{ textAlign: 'right' }}>{eur(r.usual)}</span>
                  <span className="muted">Рекоменд.</span><Bar value={r.recommended} max={max} color="var(--accent)" /><span className="num" style={{ textAlign: 'right' }}>{eur(r.recommended)}</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {r.actual > 0 && <>{eur(vsUsual, { sign: true })} к обычному · {eur(vsRec, { sign: true })} к рекомендованному. </>}
                  {r.explanation}.
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {subs.length > 0 && (
        <>
          <div className="section-title">Подписки</div>
          <div className="list">
            {subs.map((s) => (
              <div className="list-item" key={s.id}>
                <div className="grow"><div className="title">{s.name}</div><div className="sub">{eur(s.amount, { cents: true })} в месяц</div></div>
                <span className="num">≈ {eur(annualCost(s))}/год</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
