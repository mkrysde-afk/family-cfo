import { useMemo, useState } from 'react'
import {
  freeBudget,
  type CycleEnvelope,
  type MandatoryItem,
  cfoInsights,
  addDays,
  obligationsUntil,
  dueOccurrences,
  eur,
  formatDate,
  monthMandatory,
  peopleBudget,
  plannedSpending,
  type Transaction,
} from '../../engine'
import { useData, useStore } from '../../state/store'
import { Icons, useLookups, useToast } from '../components/common'
import { TransactionSheet } from '../components/TransactionSheet'
import { BudgetItemSheet } from '../components/BudgetItemSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { Route } from '../App'
import { ago } from './Sync'

/** Главный экран — минимум: общий бюджет, двое, запланированное, обязательное, один совет, последние операции */
export function Home({ go }: { go: (r: Route) => void }) {
  const data = useData()
  const { today, sync, confirmPending, confirmOccurrence, confirmAllPast, limited } = useStore()
  const toast = useToast()
  const { cat, mem } = useLookups(data)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [planning, setPlanning] = useState(false)

  const fb = useMemo(() => freeBudget(data, today), [data, today])
  const av = fb.breakdown
  const [itemEdit, setItemEdit] = useState<CycleEnvelope | 'new' | null>(null)
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

  const cycle = av.cycle
  const daysLeft = Math.max(Math.round((Date.parse(cycle.nextPayday) - Date.parse(today)) / 864e5), 1)
  // что сразу спишется из новой зарплаты (первая неделя следующего периода)
  const afterPayday = useMemo(
    () => obligationsUntil(data, addDays(cycle.horizon, 7), today).filter((o) => o.date > cycle.horizon),
    [data, today, cycle.horizon],
  )
  const unpaid = mandatory.filter((m) => m.state !== 'paid' && !m.income)
  const unpaidSum = unpaid.reduce((s, m) => s + m.amount, 0)
  const pastDue = mandatory.filter((m) => !m.income && (m.state === 'due' || m.state === 'pending'))
  const pastTransfers = due.filter((o) => o.recurring.type === 'transfer')

  function confirmAll() {
    const n = pastDue.length + pastTransfers.length
    const sum = pastDue.reduce((s, m) => s + m.amount, 0) + pastTransfers.reduce((s, o) => s + o.recurring.amount, 0)
    if (!confirm(`Отметить ${n} наступивших платежей на ${eur(sum)} как прошедшие?\n\nПоступления (зарплата, Kindergeld) отмечаются отдельно — когда деньги придут.`)) return
    confirmAllPast()
    toast(`Отмечено: ${n}`)
  }

  function tick(t: Transaction) {
    confirmPending(t.id)
    toast(`«${t.description}» — потрачено`)
  }

  const [confirming, setConfirming] = useState<MandatoryItem | null>(null)
  const me = data.settings.me
  /** в упрощённом режиме можно подтверждать только свои платежи */
  const canConfirm = (m: MandatoryItem) => !limited || m.owner === me

  function confirmMandatory(m: MandatoryItem, amount: number) {
    const o = due.find((d) => `${d.recurring.id}|${d.date}` === m.key)
    if (o) confirmOccurrence(o, amount)
    else confirmPending(m.key, amount)
    toast(`«${m.label}» — ${m.income ? 'получено' : 'оплачено'} ${eur(amount, { cents: true })}`)
  }

  // Группы по людям: сначала тот, чей это телефон
  const groups = useMemo(() => {
    const order = [...data.members.filter((x) => !x.isFamily)].sort((a, b) => Number(b.id === me) - Number(a.id === me))
    const ids = [...order.map((x) => x.id), ...new Set(mandatory.map((x) => x.owner).filter((o) => !order.some((p) => p.id === o)))]
    return ids
      .map((id) => ({ member: mem(id), items: mandatory.filter((x) => x.owner === id) }))
      .filter((g) => g.items.length > 0)
  }, [data.members, mandatory, me, mem])

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

      {/* Свободно до зарплаты (вариант А) */}
      <button className="hero center" style={{ width: '100%', background: 'none', border: 0, padding: '12px 0 10px' }} onClick={() => go('cfo')}>
        <div className="hero-label">Свободно до зарплаты · {formatDate(cycle.nextPayday)}</div>
        <div className={`hero-value num ${fb.free < 0 ? 'bad' : ''}`}>{eur(fb.free)}</div>
        <div className="hero-sub">
          {fb.free > 0 ? `≈ ${eur(Math.floor(fb.free / daysLeft))} в день · ${daysLeft} дн.` : 'Свободных денег до зарплаты нет'}
        </div>
      </button>

      {/* Полоска: как делятся деньги до зарплаты */}
      {av.available > 0 && fb.envelopes.length > 0 && (
        <div style={{ margin: '0 6px 12px' }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--card-2)' }}>
            {fb.envelopes.filter((e) => e.left > 0).map((e) => (
              <span key={e.category.id} style={{ width: `${(e.left / av.available) * 100}%`, background: e.category.color }} />
            ))}
            {fb.free > 0 && <span style={{ width: `${(fb.free / av.available) * 100}%`, background: 'var(--accent)' }} />}
          </div>
          <div className="tiny muted center" style={{ marginTop: 4 }}>
            из {eur(av.available)}: {fb.envelopes.filter((e) => e.left > 0).map((e) => `${e.category.name.toLowerCase()} ${eur(e.left)}`).join(' · ')}{fb.free > 0 ? ` · свободно ${eur(fb.free)}` : ''}
          </div>
        </div>
      )}

      {/* Статьи бюджета */}
      {fb.envelopes.map((e) => (
        <button key={e.category.id} className="card" style={{ width: '100%', border: 0, textAlign: 'left', display: 'block', padding: '11px 14px', marginBottom: 8 }} onClick={() => !limited && setItemEdit(e)}>
          <div className="row">
            <span style={{ fontWeight: 600 }}>{e.category.name}</span>
            <b className={`num ${e.left < 0 ? 'bad' : ''}`}>{e.left < 0 ? `перерасход ${eur(-e.left)}` : eur(e.left)}</b>
          </div>
          <div className="bar" style={{ margin: '6px 0 4px' }}>
            <span style={{ width: `${Math.min((e.spent / Math.max(e.amount, 1)) * 100, 100)}%`, background: e.left < 0 ? 'var(--bad)' : e.category.color }} />
          </div>
          <div className="row tiny faint">
            <span>потрачено {eur(e.spent)} из {eur(e.amount)}</span>
            <span>{e.manual ? `CFO: ${eur(e.suggested)}` : 'по рекомендации CFO'}</span>
          </div>
        </button>
      ))}
      {!limited && <button className="linklike small" style={{ display: 'block', margin: '0 auto 14px' }} onClick={() => setItemEdit('new')}>+ статья</button>}

      {cycle.salaryLate && (
        <button className="banner warn" onClick={() => go('tx')}>
          <span className="grow">Зарплата {formatDate(cycle.start)} не отмечена. Пока её нет, аренда и платежи нового периода вычтены из текущих денег.</span><span>›</span>
        </button>
      )}

      {/* Двое */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(people.people.length, 1)}, minmax(0, 1fr))`, gap: 10, marginBottom: 12 }}>
        {people.people.map((p) => (
          <div key={p.member.id} className="card" style={{ margin: 0, boxShadow: `inset 3px 0 0 ${p.member.color}` }}>
            <div style={{ fontWeight: 600, color: p.member.color }}>{p.member.name}</div>
            <div className="tiny muted" style={{ marginTop: 8 }}>Доход с {formatDate(cycle.start)}</div>
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
                {!limited || t.owner === me ? (
                  <button aria-label={`Отметить «${t.description}» потраченным`} onClick={() => tick(t)}
                    style={{ width: 24, height: 24, borderRadius: 12, border: '2px solid var(--text-3)', background: 'none', flex: 'none', padding: 0 }} />
                ) : (
                  <span style={{ width: 24, flex: 'none' }} />
                )}
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
            <span className="card-title">Платежи до зарплаты</span>
            <span className="small muted num" style={{ whiteSpace: 'nowrap' }}>{unpaid.length ? `ещё ${eur(unpaidSum)}` : 'всё оплачено'}</span>
          </div>
          {groups.map((g) => {
            const open = g.items.filter((x) => x.state !== 'paid')
            const paid = g.items.filter((x) => x.state === 'paid')
            const color = g.member && !g.member.isFamily ? g.member.color : 'var(--text-2)'
            return (
              <div key={g.member?.id ?? 'other'} style={{ marginTop: 6 }}>
                <div className="row tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', color, fontWeight: 600, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>{g.member?.name ?? 'Семья'}</span>
                  <span className="num" style={{ textTransform: 'none' }}>{open.filter((x) => !x.income).length ? `ещё ${eur(open.filter((x) => !x.income).reduce((s, x) => s + x.amount, 0))}` : ''}</span>
                </div>
                {open.map((m) => (
                  <div key={m.key} className="row" style={{ padding: '6px 0' }}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="ellipsis" style={{ display: 'block' }}>{m.label}</span>
                      <span className="tiny" style={{ color: m.state === 'upcoming' ? 'var(--text-2)' : m.income ? 'var(--good)' : 'var(--warn)' }}>
                        {formatDate(m.date)} · {m.state === 'upcoming' ? 'впереди' : m.income ? 'пришло?' : m.state === 'pending' ? 'ждёт списания' : 'списалось?'}
                      </span>
                    </span>
                    <span className={`num ${m.income ? 'good' : ''}`}>{m.income ? '+' : ''}{eur(m.amount, { cents: m.amount % 100 !== 0 })}</span>
                    {(m.state === 'due' || m.state === 'pending') && canConfirm(m) && (
                      <button className="btn small primary" aria-label={m.income ? 'Подтвердить поступление' : 'Подтвердить списание'} onClick={() => setConfirming(m)}>✓</button>
                    )}
                  </div>
                ))}
                {paid.length > 0 && (
                  <div className="tiny good" style={{ padding: '4px 0' }}>
                    оплачено: {paid.map((x) => x.label).join(', ')} ✓
                  </div>
                )}
              </div>
            )
          })}
          {afterPayday.length > 0 && (
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Из новой зарплаты в первую неделю: {[...afterPayday].sort((x, y) => y.amount - x.amount).slice(0, 3).map((o) => `${o.label} ${eur(o.amount)}`).join(', ')}
              {afterPayday.length > 3 && ` и ещё ${afterPayday.length - 3}`} — всего {eur(afterPayday.reduce((s, o) => s + o.amount, 0))}
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="linklike small" onClick={() => go('tx')}>все платежи ›</button>
            {!limited && pastDue.length + pastTransfers.length > 1 && (
              <button className="btn small" onClick={confirmAll}>✓ Отметить всё прошедшее</button>
            )}
          </div>
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
      {confirming && (
        <ConfirmSheet label={confirming.label} date={confirming.date} expected={confirming.amount} income={confirming.income}
          onConfirm={(amount) => confirmMandatory(confirming, amount)} onClose={() => setConfirming(null)} />
      )}
      {itemEdit && <BudgetItemSheet edit={itemEdit === 'new' ? undefined : itemEdit} onClose={() => setItemEdit(null)} />}
    </>
  )
}
