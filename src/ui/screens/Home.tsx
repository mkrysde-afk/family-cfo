import { useMemo, useState } from 'react'
import {
  availableToSpend,
  cfoInsights,
  daysInMonth,
  dueOccurrences,
  eur,
  formatDate,
  monthKey,
  monthMandatory,
  monthName,
  parseISO,
  peopleBudget,
  plannedSpending,
  type Transaction,
} from '../../engine'
import { useData, useStore } from '../../state/store'
import { Icons, useLookups, useToast } from '../components/common'
import { TransactionSheet } from '../components/TransactionSheet'
import type { Route } from '../App'
import { ago } from './Sync'

/** Главный экран — минимум: общий бюджет, двое, запланированное, обязательное, один совет, последние операции */
export function Home({ go }: { go: (r: Route) => void }) {
  const data = useData()
  const { today, sync, confirmPending, confirmOccurrence } = useStore()
  const toast = useToast()
  const { cat, mem } = useLookups(data)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [planning, setPlanning] = useState(false)

  const av = useMemo(() => availableToSpend(data, today), [data, today])
  const people = useMemo(() => peopleBudget(data, today), [data, today])
  const planned = useMemo(() => plannedSpending(data, today), [data, today])
  const mandatory = useMemo(() => monthMandatory(data, today), [data, today])
  const due = useMemo(() => dueOccurrences(data, today), [data, today])
  const tip = useMemo(() => {
    const all = cfoInsights(data, today)
    return all.find((i) => i.severity === 'critical' || i.severity === 'warning') ?? all[0]
  }, [data, today])
  const recent = useMemo(
    () =>
      data.transactions
        .filter((t) => t.status === 'posted')
        .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 8),
    [data.transactions],
  )

  const month = monthKey(today)
  const daysLeft = daysInMonth(month) - parseISO(today).getDate() + 1
  const unpaid = mandatory.filter((m) => m.state !== 'paid' && !m.income)
  const unpaidSum = unpaid.reduce((s, m) => s + m.amount, 0)
  const incoming = mandatory.filter((m) => m.income)

  function tick(t: Transaction) {
    confirmPending(t.id)
    toast(`«${t.description}» — потрачено`)
  }

  function confirmMandatory(key: string) {
    const o = due.find((d) => `${d.recurring.id}|${d.date}` === key)
    if (o) {
      confirmOccurrence(o)
      toast(`«${o.recurring.name}» — ${o.recurring.type === 'income' ? 'получено' : 'оплачено'}`)
      return
    }
    confirmPending(key)
    toast('Списание подтверждено')
  }

  const whenLabel = (d: string) => (d === today ? 'сегодня' : d < today ? 'просрочено' : formatDate(d))
  const txTitle = (t: Transaction) =>
    t.type === 'transfer'
      ? `${data.accounts.find((a) => a.id === t.fromAccountId)?.name ?? '?'} → ${data.accounts.find((a) => a.id === t.toAccountId)?.name ?? '?'}`
      : t.description || cat(t.categoryId)?.name || 'Операция'

  return (
    <>
      <div className="row" style={{ margin: '0 4px' }}>
        <span className="muted small">
          {sync.configured ? (
            <button className="linklike small" style={{ color: sync.status === 'error' ? 'var(--bad)' : 'var(--text-3)' }} onClick={() => go('sync')}>
              {sync.status === 'syncing' ? '⟳ синхронизация…' : sync.status === 'error' ? '⚠ нет синхронизации' : sync.status === 'offline' ? '☁︎ офлайн' : `☁︎ ${ago(sync.lastSyncAt)}`}
            </button>
          ) : (
            formatDate(today, true)
          )}
        </span>
        <button className="linklike" aria-label="Настройки" onClick={() => go('settings')} style={{ color: 'var(--text-3)', width: 24, height: 24 }}>{Icons.settings}</button>
      </div>

      {/* Общий бюджет */}
      <button className="hero center" style={{ width: '100%', background: 'none', border: 0, padding: '12px 0 18px' }} onClick={() => go('cfo')}>
        <div className="hero-label">Общий бюджет · {monthName(month, false).toLowerCase()}</div>
        <div className={`hero-value num ${av.available < 0 ? 'bad' : ''}`}>{eur(av.available)}</div>
        <div className="hero-sub">
          {av.available > 0 ? `≈ ${eur(Math.floor(av.available / daysLeft))} в день · ${daysLeft} дн.` : 'До конца месяца денег не хватает'}
        </div>
      </button>

      {/* Двое */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(people.people.length, 1)}, minmax(0, 1fr))`, gap: 10, marginBottom: 12 }}>
        {people.people.map((p) => (
          <div key={p.member.id} className="card" style={{ margin: 0, boxShadow: `inset 3px 0 0 ${p.member.color}` }}>
            <div style={{ fontWeight: 600, color: p.member.color }}>{p.member.name}</div>
            <div className="tiny muted" style={{ marginTop: 8 }}>Доход за месяц</div>
            <div className="num">{eur(p.incomeMonth)}</div>
            <div className="tiny muted" style={{ marginTop: 6 }}>Остаток</div>
            <div className={`num ${p.remaining < 0 ? 'bad' : ''}`} style={{ fontWeight: 600, fontSize: 18 }}>{eur(p.remaining)}</div>
            {p.uncertain && (
              <button className="linklike tiny" style={{ marginTop: 4, textAlign: 'left' }} onClick={() => go('settings')}>остаток карты не указан</button>
            )}
          </div>
        ))}
      </div>
      {(people.shared.balance !== 0 || people.reserved > 0) && (
        <div className="small muted row" style={{ margin: '-4px 6px 12px', justifyContent: 'flex-start', gap: 14 }}>
          {people.shared.balance !== 0 && <span>Наличные: {eur(people.shared.remaining)}</span>}
          {people.reserved > 0 && <span>Отложено на цели: {eur(people.reserved)}</span>}
        </div>
      )}

      {/* Запланировано */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">Запланировано</span>
          <button className="linklike" onClick={() => setPlanning(true)}>+ добавить</button>
        </div>
        {planned.now.length === 0 ? (
          <div className="small muted">Ничего. Например, «Маникюр — 40 €»: сумма сразу вычтется из бюджета, а когда потратите — отметьте галочкой.</div>
        ) : (
          planned.now.map((t) => {
            const m = mem(t.owner)
            const when = whenLabel(t.date)
            return (
              <div key={t.id} className="row" style={{ padding: '6px 0' }}>
                <button aria-label={`Отметить «${t.description}» потраченным`} onClick={() => tick(t)}
                  style={{ width: 24, height: 24, borderRadius: 12, border: '2px solid var(--text-3)', background: 'none', flex: 'none', padding: 0 }} />
                <button className="grow" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => setEditing(t)}>
                  <div className="ellipsis">{t.description}</div>
                  <div className="tiny" style={{ color: when === 'просрочено' ? 'var(--bad)' : when === 'сегодня' ? 'var(--accent)' : 'var(--text-2)' }}>
                    {when}{m && !m.isFamily ? <> · <span style={{ color: m.color }}>{m.name}</span></> : null}
                  </div>
                </button>
                <span className="num">{eur(t.amount, { cents: t.amount % 100 !== 0 })}</span>
              </div>
            )
          })
        )}
        {planned.later.length > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>Позже: {planned.later.map((t) => `${t.description} (${formatDate(t.date)})`).join(', ')}</div>}
      </div>

      {/* Обязательные платежи */}
      {mandatory.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Обязательные платежи</span>
            <span className="small muted num" style={{ whiteSpace: 'nowrap' }}>{unpaid.length ? `ещё ${eur(unpaidSum)}` : 'всё оплачено'}</span>
          </div>
          {[...incoming, ...unpaid.slice(0, 6), ...mandatory.filter((m) => m.state === 'paid').slice(0, Math.max(0, 6 - unpaid.length))].map((m) => (
            <div key={m.key} className="row" style={{ padding: '6px 0' }}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: 'block' }}>{m.label}</span>
                <span className="tiny" style={{ color: m.state === 'paid' ? 'var(--good)' : m.state === 'upcoming' ? 'var(--text-2)' : m.income ? 'var(--good)' : 'var(--warn)' }}>
                  {formatDate(m.date)} · {m.state === 'paid' ? 'оплачено ✓' : m.state === 'upcoming' ? 'впереди' : m.income ? 'пришло?' : m.state === 'pending' ? 'ждёт списания' : 'списалось?'}
                </span>
              </span>
              <span className={`num ${m.income ? 'good' : m.state === 'paid' ? 'faint' : ''}`}>{m.income ? '+' : ''}{eur(m.amount, { cents: m.amount % 100 !== 0 })}</span>
              {(m.state === 'due' || m.state === 'pending') && (
                <button className="btn small primary" aria-label={m.income ? 'Подтвердить поступление' : 'Подтвердить списание'} onClick={() => confirmMandatory(m.key)}>✓</button>
              )}
            </div>
          ))}
          <button className="linklike small" style={{ marginTop: 4 }} onClick={() => go('tx')}>все платежи ›</button>
        </div>
      )}

      {/* Один совет CFO */}
      {tip && (
        <button className="card row" style={{ width: '100%', border: 0, textAlign: 'left', gap: 10 }} onClick={() => go('cfo')}>
          <span className="dot" style={{ background: tip.severity === 'critical' ? 'var(--bad)' : tip.severity === 'warning' ? 'var(--warn)' : 'var(--accent)' }} />
          <span className="grow small">{tip.title}</span>
          <span className="faint">›</span>
        </button>
      )}

      {/* Последние операции */}
      <div className="card" style={{ paddingBottom: 6 }}>
        <div className="card-head">
          <span className="card-title">Последние операции</span>
          <button className="linklike small" onClick={() => go('tx')}>все</button>
        </div>
        {recent.length === 0 && <div className="small muted" style={{ paddingBottom: 8 }}>Пока пусто. Нажмите «+» внизу, чтобы добавить расход.</div>}
        {recent.map((t) => {
          const m = mem(t.owner)
          const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''
          return (
            <button key={t.id} className="row" style={{ width: '100%', background: 'none', border: 0, padding: '7px 0', textAlign: 'left' }} onClick={() => setEditing(t)}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: 'block' }}>{txTitle(t)}</span>
                <span className="tiny muted">
                  {formatDate(t.date)}
                  {m && !m.isFamily && <> · <span style={{ color: m.color }}>{m.name}</span></>}
                </span>
              </span>
              <span className={`num ${t.type === 'income' ? 'good' : ''}`}>{sign}{eur(t.amount, { cents: true })}</span>
            </button>
          )
        })}
      </div>

      {editing && <TransactionSheet edit={editing} onClose={() => setEditing(null)} />}
      {planning && <TransactionSheet plan onClose={() => setPlanning(false)} />}
    </>
  )
}
