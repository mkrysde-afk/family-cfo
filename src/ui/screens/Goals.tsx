import { useMemo, useState } from 'react'
import { debtStatus, emergencyFund, eur, formatDate, goalProgress, parseAmount, type Goal } from '../../engine'
import { newId, useData, useStore } from '../../state/store'
import { Bar, ConfBadge, Sheet, Switch, useToast } from '../components/common'

function GoalSheet({ edit, onClose }: { edit?: Goal; onClose: () => void }) {
  const { saveGoal, deleteGoal } = useStore()
  const toast = useToast()
  const [name, setName] = useState(edit?.name ?? '')
  const [target, setTarget] = useState(edit ? String(edit.target / 100) : '')
  const [current, setCurrent] = useState(edit ? String(edit.current / 100) : '0')
  const [date, setDate] = useState(edit?.targetDate ?? '')
  const [reserve, setReserve] = useState(edit?.reserve ?? true)
  const t = parseAmount(target)
  const c = current.trim() === '' || current.trim() === '0' ? 0 : parseAmount(current)
  const valid = !!name.trim() && !!t && c !== null

  function save() {
    if (!valid || !t) return
    saveGoal({ ...edit, id: edit?.id ?? newId('goal'), name: name.trim(), target: t, current: c ?? 0, targetDate: date || undefined, reserve })
    toast('Цель сохранена')
    onClose()
  }
  return (
    <Sheet title={edit ? 'Цель' : 'Новая цель'} onClose={onClose} onDone={save} doneDisabled={!valid}>
      <div className="list">
        <div className="field"><label htmlFor="gn">Название</label><input id="gn" value={name} placeholder="Отпуск" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="gt">Сумма цели, €</label><input id="gt" inputMode="decimal" value={target} placeholder="2000" onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        <div className="field"><label htmlFor="gc">Уже есть, €</label><input id="gc" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        <div className="field"><label htmlFor="gd">К дате</label><input id="gd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Держу на обычной карте</label><span className="grow" /><Switch checked={reserve} onChange={setReserve} label="Резерв" /></div>
      </div>
      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        Если деньги цели лежат на обычной карте, они вычитаются из «Можно потратить», чтобы их случайно не потратить.
      </p>
      <button className="btn primary block" onClick={save} disabled={!valid}>Сохранить</button>
      {edit && <button className="btn danger block" style={{ marginTop: 8 }} onClick={() => { if (confirm('Удалить цель?')) { deleteGoal(edit.id); onClose() } }}>Удалить цель</button>}
    </Sheet>
  )
}

export function Goals() {
  const data = useData()
  const { today, contributeGoal } = useStore()
  const toast = useToast()
  const ef = useMemo(() => emergencyFund(data, today), [data, today])
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)

  function contribute(g: Goal) {
    const input = prompt(`Сколько отложить на «${g.name}», €?`)
    if (input === null) return
    const v = parseAmount(input)
    if (!v) return toast('Неверная сумма')
    contributeGoal(g.id, v)
    toast(`+${eur(v)} на «${g.name}»`)
  }

  return (
    <>
      <h1 className="page-title">Цели</h1>

      <div className="card">
        <div className="card-head"><span className="card-title">Финансовая подушка</span><ConfBadge c={ef.confidence} short /></div>
        <div className="row"><span className="muted">Сейчас</span><b className="num">{eur(ef.current)}</b></div>
        <div className="row small"><span className="muted">Обязательные расходы в месяц</span><span className="num">{eur(ef.essentialMonthly)}</span></div>
        <div style={{ margin: '10px 0 4px' }}><Bar value={ef.current} max={ef.target6} color="var(--good)" marker={ef.target3} /></div>
        <div className="row small"><span className="muted">Цель 3 месяца</span><span className="num">{eur(ef.target3)} · не хватает {eur(ef.need3)}</span></div>
        <div className="row small"><span className="muted">Цель 6 месяцев</span><span className="num">{eur(ef.target6)} · не хватает {eur(ef.need6)}</span></div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Сейчас подушки хватит на {ef.months.toFixed(1).replace('.', ',')} мес. Чтобы собрать 3 месяца за год, нужно откладывать ≈ {eur(Math.ceil(ef.need3 / 12))} в месяц.
        </p>
      </div>

      <div className="section-title">Цели</div>
      {data.goals.length === 0 && <div className="card empty">Целей пока нет.</div>}
      {data.goals.map((g) => {
        const p = goalProgress(g, today)
        return (
          <div className="card" key={g.id}>
            <div className="card-head">
              <span className="card-title">{g.name}</span>
              <button className="linklike small" onClick={() => setEditing(g)}>Изменить</button>
            </div>
            <div className="row small"><span className="num"><b>{eur(g.current)}</b> из {eur(g.target)}</span><span className="muted num">{Math.round(p.progress * 100)}%</span></div>
            <div style={{ margin: '6px 0' }}><Bar value={g.current} max={g.target} color="var(--accent)" /></div>
            {g.targetDate && (
              <p className="small" style={{ margin: '6px 0' }}>
                {p.remaining === 0
                  ? 'Цель достигнута.'
                  : p.overdue
                    ? <span className="bad">Срок прошёл, не хватает {eur(p.remaining)}.</span>
                    : <>Чтобы успеть к {formatDate(g.targetDate, true)}, откладывайте ≈ <b>{eur(p.monthlyRequired ?? 0)}</b> в месяц.</>}
              </p>
            )}
            {g.note && <p className="tiny muted" style={{ margin: '4px 0' }}>{g.note}</p>}
            <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 6 }}>
              <button className="btn small primary" onClick={() => contribute(g)}>Отложить</button>
              {g.reserve && <span className="tiny muted">вычитается из «Можно потратить»</span>}
            </div>
          </div>
        )
      })}
      <button className="btn block" onClick={() => setEditing('new')}>Добавить цель</button>

      {data.debts.length > 0 && (
        <>
          <div className="section-title">Долги</div>
          {data.debts.map((d) => {
            const s = debtStatus(data, d, today)
            return (
              <div className="card" key={d.id}>
                <div className="card-head"><span className="card-title">{d.name}</span><ConfBadge c={d.confidence} short /></div>
                <div className="row small"><span className="muted">Кредитор</span><span>{d.lender}</span></div>
                <div className="row small"><span className="muted">Получено</span><span className="num">{d.principal === null ? 'недостаточно данных' : eur(d.principal)}</span></div>
                <div className="row small"><span className="muted">Всего вернуть</span><span className="num">{d.totalToRepay === null ? 'недостаточно данных' : eur(d.totalToRepay)}</span></div>
                <div className="row small"><span className="muted">Процентная ставка</span><span>{d.interestRate === null ? 'недостаточно данных' : `${d.interestRate}%`}</span></div>
                <div className="row small"><span className="muted">Уже возвращено</span><span className="num">{eur(s.paid)}</span></div>
                <div className="row"><b>Осталось</b><b className="num">{s.remaining === null ? 'недостаточно данных' : eur(s.remaining)}</b></div>
                {d.totalToRepay && <div style={{ margin: '8px 0' }}><Bar value={s.paid} max={d.totalToRepay} color="var(--good)" /></div>}
                <details>
                  <summary className="small" style={{ color: 'var(--accent)', cursor: 'pointer' }}>График платежей ({s.nextPayments.length})</summary>
                  <div className="stack small" style={{ marginTop: 6 }}>
                    {s.nextPayments.map((x, i) => (
                      <div className="row" key={i}><span className="muted">{formatDate(x.date, true)} · {x.kind}</span><span className="num">{eur(x.amount)}</span></div>
                    ))}
                  </div>
                </details>
                {d.note && <p className="tiny muted" style={{ marginBottom: 0 }}>{d.note}</p>}
              </div>
            )
          })}
        </>
      )}

      {editing && <GoalSheet edit={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
