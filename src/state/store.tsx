import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  addDays,
  availableToSpend,
  effectOn,
  learnRule,
  occurrenceToTransaction,
  today as todayFn,
  type Account,
  type AppData,
  type Category,
  type Cents,
  type Goal,
  type ISODate,
  type Occurrence,
  type Recurring,
  type Settings,
  type Transaction,
} from '../engine'
import { migrate } from '../storage/backup'
import { requestPersistence, storage } from '../storage/storage'

export function newId(prefix = 'id'): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14)
  return `${prefix}-${r}`
}

export type NewTransaction = Omit<Transaction, 'id'>

interface Store {
  data: AppData | null
  loading: boolean
  today: ISODate
  setData: (d: AppData) => void
  addTransaction: (t: NewTransaction, learn?: boolean) => void
  updateTransaction: (t: Transaction, learn?: boolean) => void
  deleteTransaction: (id: string) => void
  confirmOccurrence: (o: Occurrence, amount?: Cents, date?: ISODate) => void
  skipOccurrence: (o: Occurrence) => void
  confirmPending: (id: string) => void
  saveRecurring: (r: Recurring) => void
  deleteRecurring: (id: string) => void
  saveGoal: (g: Goal) => void
  deleteGoal: (id: string) => void
  contributeGoal: (id: string, amount: Cents) => void
  saveAccount: (a: Account) => void
  setAccountBalance: (id: string, amount: Cents) => void
  saveCategory: (c: Category) => void
  renameMember: (id: string, name: string) => void
  updateSettings: (s: Partial<Settings>) => void
  deleteRule: (id: string) => void
  reset: () => Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

/** Данные гарантированно загружены (используется внутри экранов) */
export function useData(): AppData {
  const { data } = useStore()
  if (!data) throw new Error('Данные не загружены')
  return data
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<AppData | null>(null)
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState(todayFn())
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    storage.load().then((d) => {
      setDataState(d ? migrate(d) : null)
      setLoading(false)
    })
    requestPersistence()
    // смена дня, если приложение открыто долго
    const t = window.setInterval(() => setToday(todayFn()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const commit = useCallback((next: AppData) => {
    setDataState(next)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => storage.save(next), 150)
  }, [])

  const update = useCallback(
    (fn: (d: AppData) => AppData) => {
      setDataState((prev) => {
        if (!prev) return prev
        const next = fn(prev)
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => storage.save(next), 150)
        return next
      })
    },
    [],
  )

  // Ежедневный снимок «Можно потратить» для блока «Что изменилось»
  useEffect(() => {
    if (!data) return
    const available = availableToSpend(data, today).available
    const snaps = data.snapshots ?? []
    const existing = snaps.find((s) => s.date === today)
    if (existing && existing.available === available) return
    const next = [...snaps.filter((s) => s.date !== today), { date: today, available }].sort((a, b) => a.date.localeCompare(b.date)).slice(-120)
    update((d) => ({ ...d, snapshots: next }))
  }, [data, today, update])

  const store = useMemo<Store>(() => {
    const withLearning = (d: AppData, t: Transaction | NewTransaction, learn?: boolean) =>
      learn && t.categoryId && t.description.trim() ? learnRule(d, t.description, t.categoryId, t.scope, () => newId('rule')) : d.rules

    return {
      data,
      loading,
      today,
      // Загруженный файл сам является резервной копией — отсчёт напоминания начинается с этого момента
      setData: (d) => {
        const m = migrate(d)
        commit({ ...m, settings: { ...m.settings, lastBackupAt: m.settings.lastBackupAt ?? new Date().toISOString() } })
      },
      addTransaction: (t, learn) =>
        update((d) => ({ ...d, rules: withLearning(d, t, learn), transactions: [...d.transactions, { ...t, id: newId('tx') }] })),
      updateTransaction: (t, learn) =>
        update((d) => ({ ...d, rules: withLearning(d, t, learn), transactions: d.transactions.map((x) => (x.id === t.id ? t : x)) })),
      deleteTransaction: (id) => update((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== id) })),
      confirmOccurrence: (o, amount, date) =>
        update((d) => ({ ...d, transactions: [...d.transactions, occurrenceToTransaction(o, newId('tx'), amount, date)] })),
      skipOccurrence: (o) => update((d) => ({ ...d, skipped: [...d.skipped, { recurringId: o.recurring.id, occurrence: o.date }] })),
      confirmPending: (id) =>
        update((d) => ({ ...d, transactions: d.transactions.map((x) => (x.id === id ? { ...x, status: 'posted' as const, date: x.date < today ? x.date : today } : x)) })),
      saveRecurring: (r) =>
        update((d) => ({ ...d, recurring: d.recurring.some((x) => x.id === r.id) ? d.recurring.map((x) => (x.id === r.id ? r : x)) : [...d.recurring, r] })),
      deleteRecurring: (id) => update((d) => ({ ...d, recurring: d.recurring.filter((x) => x.id !== id) })),
      saveGoal: (g) => update((d) => ({ ...d, goals: d.goals.some((x) => x.id === g.id) ? d.goals.map((x) => (x.id === g.id ? g : x)) : [...d.goals, g] })),
      deleteGoal: (id) => update((d) => ({ ...d, goals: d.goals.filter((x) => x.id !== id) })),
      contributeGoal: (id, amount) =>
        update((d) => ({
          ...d,
          goals: d.goals.map((g) => (g.id === id ? { ...g, current: Math.max(g.current + amount, 0), contributions: [...(g.contributions ?? []), { date: today, amount }] } : g)),
        })),
      saveAccount: (a) =>
        update((d) => ({ ...d, accounts: d.accounts.some((x) => x.id === a.id) ? d.accounts.map((x) => (x.id === a.id ? a : x)) : [...d.accounts, a] })),
      // Остаток «сейчас»: якорь ставится на конец вчерашнего дня с учётом сегодняшних операций,
      // чтобы операции, введённые сегодня позже, продолжали менять баланс.
      setAccountBalance: (id, amount) =>
        update((d) => {
          const todays = d.transactions.filter((t) => t.status === 'posted' && t.date === today).reduce((s, t) => s + effectOn(t, id), 0)
          return {
            ...d,
            accounts: d.accounts.map((a) => (a.id === id ? { ...a, anchor: { date: addDays(today, -1), amount: amount - todays }, balanceConfidence: 'high' as const } : a)),
          }
        }),
      saveCategory: (c) =>
        update((d) => ({ ...d, categories: d.categories.some((x) => x.id === c.id) ? d.categories.map((x) => (x.id === c.id ? c : x)) : [...d.categories, c] })),
      renameMember: (id, name) => update((d) => ({ ...d, members: d.members.map((m) => (m.id === id ? { ...m, name } : m)) })),
      updateSettings: (s) => update((d) => ({ ...d, settings: { ...d.settings, ...s } })),
      deleteRule: (id) => update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id) })),
      reset: async () => {
        await storage.clear()
        setDataState(null)
      },
    }
  }, [data, loading, today, commit, update])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
