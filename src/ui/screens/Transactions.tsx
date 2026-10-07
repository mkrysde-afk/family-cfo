import { useMemo, useState } from 'react'
import {
  addDays,
  addMonths,
  annualCost,
  dueOccurrences,
  eur,
  formatDate,
  FREQ_LABEL,
  monthKey,
  monthName,
  occurrences,
  type Occurrence,
  type Recurring,
  type Transaction,
} from '../../engine'
import { useData, useStore } from '../../state/store'
import { ConfBadge, Icons, Segmented, useLookups, useToast } from '../components/common'
import { RecurringSheet } from '../components/RecurringSheet'
import { TransactionSheet } from '../components/TransactionSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'

type Filter = 'all' | 'expense' | 'income' | 'transfer'

export function Transactions() {
  const data = useData()
  const { today, confirmOccurrence, skipOccurrence, confirmPending, limited } = useStore()
  const me = data.settings.me
  // чей платёж: владелец, а если «Семья» — владелец карты
  const ownerOf = (owner: string, accountId?: string) => (data.members.some((m) => m.id === owner && !m.isFamily) ? owner : data.accounts.find((a) => a.id === accountId)?.owner ?? owner)
  const canConfirm = (owner: string, accountId?: string) => !limited || ownerOf(owner, accountId) === me
  const [confirming, setConfirming] = useState<{ label: string; date: string; amount: number; income: boolean; run: (a: number) => void } | null>(null)
  const toast = useToast()
  const { cat, acc, mem } = useLookups(data)
  const [tab, setTab] = useState<'list' | 'recurring'>('list')
  const [month, setMonth] = useState(monthKey(today))
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [editingRec, setEditingRec] = useState<Recurring | 'new' | null>(null)

  const due = useMemo(() => dueOccurrences(data, today), [data, today])
  const pendingTx = data.transactions.filter((t) => t.status === 'pending' || (t.status === 'planned' && t.date <= today))
  const upcoming = useMemo(
    () => occurrences(data, addDays(today, 1), addDays(today, 31), today).filter((o) => o.state === 'upcoming'),
    [data, today],
  )
  const plannedTx = data.transactions.filter((t) => t.status === 'planned' && t.date > today).sort((a, b) => a.date.localeCompare(b.date))

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.transactions
      .filter((t) => t.status === 'posted' && monthKey(t.date) === month)
      .filter((t) => filter === 'all' || t.type === filter)
      .filter((t) => !needle || t.description.toLowerCase().includes(needle) || (cat(t.categoryId)?.name.toLowerCase().includes(needle) ?? false))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  }, [data.transactions, month, filter, q, cat])

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of list) m.set(t.date, [...(m.get(t.date) ?? []), t])
    return [...m.entries()]
  }, [list])

  const sumExp = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const sumInc = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  function confirmOcc(o: Occurrence) {
    setConfirming({ label: o.recurring.name, date: o.date, amount: o.recurring.amount, income: o.recurring.type === 'income', run: (a) => { confirmOccurrence(o, a); toast('Подтверждено') } })
  }

  function txTitle(t: Transaction) {
    if (t.type === 'transfer') return `${acc(t.fromAccountId)?.name ?? 'удалённый счёт'} → ${acc(t.toAccountId)?.name ?? 'удалённый счёт'}`
    return t.description || cat(t.categoryId)?.name || 'Операция'
  }

  function TxRow({ t }: { t: Transaction }) {
    const m = mem(t.owner)
    const c = cat(t.categoryId)
    const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''
    return (
      <button className="list-item" onClick={() => setEditing(t)}>
        <span className="icon-circle" style={{ background: t.type === 'transfer' ? 'var(--text-3)' : c?.color ?? '#999', fontSize: 13 }}>
          {t.type === 'transfer' ? '⇄' : (c?.name ?? 'удалённый счёт').slice(0, 1)}
        </span>
        <div className="grow">
          <div className="title ellipsis">{txTitle(t)}</div>
          <div className="sub ellipsis">
            {t.type === 'transfer' ? 'Перевод — не расход' : c?.name}
            {m && !m.isFamily && <> · <span style={{ color: m.color }}>{m.name}</span></>}
            {t.scope === 'personal' && ' · личное'}
            {t.confidence === 'low' && ' · неточно'}
          </div>
        </div>
        <span className={`num ${t.type === 'income' ? 'good' : ''}`} style={{ fontWeight: 500 }}>{sign}{eur(t.amount, { cents: true })}</span>
      </button>
    )
  }

  return (
    <>
      <h1 className="page-title">Операции</h1>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={tab} options={[['list', 'История'], ['recurring', 'Регулярные']]} onChange={setTab} />
      </div>

      {tab === 'list' ? (
        <>
          {(due.length > 0 || pendingTx.length > 0) && (
            <>
              <div className="section-title">Ждут подтверждения</div>
              <div className="list">
                {pendingTx.map((t) => (
                  <div className="list-item" key={t.id}>
                    <div className="grow">
                      <div className="title ellipsis">{t.description}</div>
                      <div className="sub">{formatDate(t.date)} · {t.status === 'pending' ? 'ожидает списания в банке' : 'запланировано'}</div>
                    </div>
                    <span className="num">{eur(t.amount, { cents: true })}</span>
                    {canConfirm(t.owner, t.accountId) && (
                      <button className="btn small primary" onClick={() => setConfirming({ label: t.description, date: t.date, amount: t.amount, income: t.type === 'income', run: (a) => { confirmPending(t.id, a); toast('Проведено') } })}>Прошло</button>
                    )}
                  </div>
                ))}
                {due.map((o) => (
                  <div className="list-item" key={o.recurring.id + o.date}>
                    <div className="grow">
                      <div className="title ellipsis">{o.recurring.name}</div>
                      <div className="sub">{formatDate(o.date)} · {o.recurring.type === 'income' ? 'поступление' : 'списание'} · <span style={{ color: mem(ownerOf(o.recurring.owner, o.recurring.accountId))?.color }}>{mem(ownerOf(o.recurring.owner, o.recurring.accountId))?.name}</span></div>
                    </div>
                    <span className={`num ${o.recurring.type === 'income' ? 'good' : ''}`}>{eur(o.recurring.amount, { cents: true })}</span>
                    {canConfirm(o.recurring.owner, o.recurring.accountId) && (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn small" aria-label="Не было" onClick={() => { skipOccurrence(o); toast('Пропущено') }}>Нет</button>
                        <button className="btn small primary" onClick={() => confirmOcc(o)}>Да</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="small muted" style={{ margin: '-4px 4px 12px' }}>Проверьте в банке, что операция прошла. «Нет» — если в этот раз её не было.</p>
            </>
          )}

          {(plannedTx.length > 0 || upcoming.length > 0) && (
            <details className="card" style={{ padding: '10px 16px' }}>
              <summary className="card-title" style={{ cursor: 'pointer' }}>Ближайшие 30 дней: {plannedTx.filter((t) => t.date <= addDays(today, 31)).length + upcoming.length}</summary>
              <div className="stack small" style={{ marginTop: 8 }}>
                {[...upcoming.map((o) => ({ date: o.date, label: o.recurring.name, amount: o.recurring.amount, income: o.recurring.type === 'income', tx: undefined as Transaction | undefined })),
                  ...plannedTx.map((t) => ({ date: t.date, label: t.description, amount: t.amount, income: t.type === 'income', tx: t }))]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((x, i) => (
                    <div className="row" key={i} onClick={() => x.tx && setEditing(x.tx)} style={{ cursor: x.tx ? 'pointer' : undefined }}>
                      <span className="muted ellipsis">{formatDate(x.date)} · {x.label}</span>
                      <span className={`num ${x.income ? 'good' : ''}`}>{x.income ? '+' : '−'}{eur(x.amount, { cents: true })}</span>
                    </div>
                  ))}
              </div>
            </details>
          )}

          <div className="card-head" style={{ margin: '4px 4px 8px' }}>
            <button className="linklike" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>{Icons.left}</button>
            <span className="card-title">{monthName(month)}</span>
            <button className="linklike" aria-label="Следующий месяц" style={{ transform: 'scaleX(-1)', opacity: month >= monthKey(today) ? 0.3 : 1 }} disabled={month >= monthKey(today)} onClick={() => setMonth(addMonths(month, 1))}>{Icons.left}</button>
          </div>
          <input className="input" placeholder="Поиск" aria-label="Поиск операций" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ marginBottom: 8 }}>
            <Segmented value={filter} options={[['all', 'Все'], ['expense', 'Расходы'], ['income', 'Доходы'], ['transfer', 'Переводы']]} onChange={setFilter} />
          </div>
          <div className="row small muted" style={{ margin: '0 4px 8px' }}>
            <span>Расходы {eur(sumExp)}</span>
            <span>Доходы <span className="good">{eur(sumInc)}</span></span>
          </div>

          {groups.length === 0 && <div className="card empty">За этот месяц операций нет.</div>}
          {groups.map(([date, txs]) => (
            <div key={date}>
              <div className="section-title" style={{ marginTop: 12 }}>{formatDate(date)}</div>
              <div className="list">{txs.map((t) => <TxRow key={t.id} t={t} />)}</div>
            </div>
          ))}
        </>
      ) : (
        <>
          <button className="btn primary block" style={{ marginBottom: 12 }} onClick={() => setEditingRec('new')}>{limited ? 'Добавить свой регулярный платёж' : 'Добавить регулярный платёж'}</button>
          {[...data.members.filter((m) => !m.isFamily).sort((a, b) => Number(b.id === me) - Number(a.id === me)), ...data.members.filter((m) => m.isFamily)].map((m) => {
            const items = data.recurring
              .filter((r) => ownerOf(r.owner, r.accountId) === m.id)
              .sort((a, b) => Number(b.active) - Number(a.active) || Number(a.type !== 'income') - Number(b.type !== 'income') || Number(a.startDate.slice(8)) - Number(b.startDate.slice(8)))
            if (!items.length) return null
            const monthly = items.filter((r) => r.active && r.type === 'expense').reduce((s, r) => s + Math.round(annualCost(r) / 12), 0)
            return (
              <div key={m.id}>
                <div className="section-title row" style={{ color: m.isFamily ? undefined : m.color }}>
                  <span>{m.name}</span>
                  <span style={{ textTransform: 'none' }}>≈ {eur(monthly)}/мес</span>
                </div>
                <div className="list">
                  {items.map((r) => (
                    <button className="list-item" key={r.id} onClick={() => (!limited || ownerOf(r.owner, r.accountId) === me ? setEditingRec(r) : toast('Изменить этот платёж можно на основном телефоне'))} style={{ opacity: r.active ? 1 : 0.5 }}>
                      <span className="dot" style={{ background: r.type === 'income' ? 'var(--good)' : r.type === 'transfer' ? 'var(--text-3)' : cat(r.categoryId)?.color }} />
                      <div className="grow">
                        <div className="title ellipsis">{r.name}</div>
                        <div className="sub ellipsis">
                          {Number(r.startDate.slice(8))}-го · {FREQ_LABEL[r.frequency]} · {acc(r.accountId)?.name}
                          {!r.active && ' · отключён'}
                          {r.endDate && ` · до ${formatDate(r.endDate, true)}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className={`num ${r.type === 'income' ? 'good' : ''}`}>{r.type === 'income' ? '+' : ''}{eur(r.amount, { cents: true })}</div>
                        {r.confidence !== 'high' && <ConfBadge c={r.confidence} short />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {editing && <TransactionSheet edit={editing} onClose={() => setEditing(null)} />}
      {confirming && (
        <ConfirmSheet label={confirming.label} date={confirming.date} expected={confirming.amount} income={confirming.income} onConfirm={confirming.run} onClose={() => setConfirming(null)} />
      )}
      {editingRec && <RecurringSheet edit={editingRec === 'new' ? undefined : editingRec} onClose={() => setEditingRec(null)} />}
    </>
  )
}
