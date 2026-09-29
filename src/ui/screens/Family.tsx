import { useMemo, useState } from 'react'
import { addMonths, dataMonths, eur, formatDate, familyContribution, monthEnd, monthKey, monthName, monthStart } from '../../engine'
import { useData, useStore } from '../../state/store'
import { Bar, Initial, Segmented } from '../components/common'

type Period = 'month' | 'last' | 'six'

export function Family() {
  const data = useData()
  const { today } = useStore()
  const [period, setPeriod] = useState<Period>('last')
  const cur = monthKey(today)
  const range = useMemo(() => {
    if (period === 'month') return { from: monthStart(cur), to: today, label: monthName(cur) }
    if (period === 'last') {
      const m = dataMonths(data, cur, 1)[0] ?? addMonths(cur, -1)
      return { from: monthStart(m), to: monthEnd(m), label: monthName(m) }
    }
    const ms = dataMonths(data, cur, 6)
    const first = ms[ms.length - 1] ?? addMonths(cur, -6)
    const last = ms[0] ?? addMonths(cur, -1)
    return { from: monthStart(first), to: monthEnd(last), label: `${monthName(first)} — ${monthName(last)}` }
  }, [period, data, cur, today])
  const c = useMemo(() => familyContribution(data, range.from, range.to), [data, range])

  return (
    <>
      <h1 className="page-title">Семья</h1>
      <p className="page-sub">Прозрачная статистика: кто сколько заработал и оплатил. Не рейтинг.</p>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={period} options={[['month', 'Этот месяц'], ['last', 'Прошлый'], ['six', '6 месяцев']]} onChange={setPeriod} />
      </div>
      <p className="small muted" style={{ margin: '0 4px 10px' }}>{range.label}</p>

      {c.members.map((m) => (
        <div className="card" key={m.member.id} style={{ boxShadow: `inset 4px 0 0 ${m.member.color}` }}>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 10, marginBottom: 10 }}>
            <Initial name={m.member.name} color={m.member.color} />
            <span className="card-title" style={{ color: m.member.color }}>{m.member.name}</span>
          </div>
          <div className="row"><span className="muted">Доход</span><span className="num good">{eur(m.income)}</span></div>
          <div className="row"><span className="muted">Оплатил(а) общих расходов</span><span className="num">{eur(m.familyPaid)}</span></div>
          <div className="row"><span className="muted">Личные расходы</span><span className="num">{eur(m.personal)}</span></div>
          <div className="row" style={{ marginTop: 8 }}><span className="muted">Доля в общих расходах</span><b className="num">{Math.round(m.share * 100)}%</b></div>
          <div style={{ marginTop: 6 }}><Bar value={m.share} max={1} color={m.member.color} /></div>
        </div>
      ))}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Вся семья</div>
        <div className="row"><span className="muted">Общий доход</span><span className="num good">{eur(c.totalIncome)}</span></div>
        <div className="row"><span className="muted">Общие расходы</span><span className="num">{eur(c.totalFamily)}</span></div>
        <div className="row"><span className="muted">Личные расходы</span><span className="num">{eur(c.totalPersonal)}</span></div>
        {c.unassignedFamily > 0 && <div className="row small"><span className="muted">из них без плательщика (Kindergeld и т.п.)</span><span className="num">{eur(c.unassignedFamily)}</span></div>}
        <div className="divider" />
        <div className="row"><b>Отложено / итог</b><b className={`num ${c.savings < 0 ? 'bad' : 'good'}`}>{eur(c.savings, { sign: true })}</b></div>
      </div>
      {data.settings.coverage.length > 0 && (
        <p className="small muted" style={{ margin: '0 4px' }}>
          История до {formatDate(data.settings.trackingStart, true)} взята из банковских выписок: {data.settings.coverage.map((x) => x.label).join(', ')}. Счета, по которым выписок не было, за этот период не видны.
        </p>
      )}
    </>
  )
}
