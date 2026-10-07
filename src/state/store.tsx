import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  addDays,
  availableToSpend,
  effectOn,
  learnRule,
  splitCashPerPerson,
  dueOccurrences,
  mergeData,
  type MergeStats,
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
import { DEFAULT_PATH, fetchRemote, loadSyncConfig, refOf, saveSyncConfig, syncOnce, type SyncConfig } from '../sync/autoSync'
import { WrongPasswordError } from '../sync/crypto'
import { AuthError, checkRepo, NetworkError } from '../sync/github'
import { requestPersistence, storage } from '../storage/storage'
import { hashPin, loadDevicePrefs, saveDevicePrefs } from './device'

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
  confirmPending: (id: string, amount?: Cents) => void
  /** Отметить прошедшими все наступившие обязательные платежи (без поступлений) */
  confirmAllPast: () => void
  saveRecurring: (r: Recurring) => void
  deleteRecurring: (id: string) => void
  saveGoal: (g: Goal) => void
  deleteGoal: (id: string) => void
  contributeGoal: (id: string, amount: Cents) => void
  saveAccount: (a: Account) => void
  /** удалить источник денег совсем (история операций остаётся) */
  deleteAccount: (id: string) => void
  setAccountBalance: (id: string, amount: Cents) => void
  saveCategory: (c: Category) => void
  renameMember: (id: string, name: string) => void
  updateSettings: (s: Partial<Settings>) => void
  deleteRule: (id: string) => void
  syncWith: (remote: AppData) => MergeStats
  /** Автосинхронизация через закрытый репозиторий GitHub */
  sync: SyncState
  connectSync: (c: ConnectParams) => Promise<{ created: boolean; stats: MergeStats }>
  joinFamily: (c: ConnectParams) => Promise<void>
  disconnectSync: () => void
  syncNow: () => void
  /** Упрощённый режим этого телефона: только просмотр и ввод операций */
  limited: boolean
  enableLimited: (pin: string) => Promise<void>
  disableLimited: (pin: string) => Promise<boolean>
  reset: () => Promise<void>
}

export interface ConnectParams {
  owner: string
  repo: string
  token: string
  password: string
}

export interface SyncState {
  configured: boolean
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncAt?: string
  error?: string
  repo?: string
}

function errorText(e: unknown): string {
  if (e instanceof WrongPasswordError || e instanceof AuthError || e instanceof NetworkError) return e.message
  return e instanceof Error ? e.message : 'Неизвестная ошибка синхронизации'
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
  const [device, setDevice] = useState(loadDevicePrefs())
  const saveTimer = useRef<number | undefined>(undefined)

  // --- автосинхронизация ---
  const cfgRef = useRef<SyncConfig | null>(loadSyncConfig())
  const dataRef = useRef<AppData | null>(null)
  const versionRef = useRef(0) // растёт при каждом изменении пользователем
  const syncingRef = useRef(false)
  const syncTimer = useRef<number | undefined>(undefined)
  const [sync, setSync] = useState<SyncState>(() => {
    const c = cfgRef.current
    return c ? { configured: true, status: 'idle', lastSyncAt: c.lastSyncAt, error: c.lastError, repo: `${c.owner}/${c.repo}` } : { configured: false, status: 'off' }
  })
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const setCfg = useCallback((c: SyncConfig | null) => {
    cfgRef.current = c
    saveSyncConfig(c)
  }, [])

  const runSync = useCallback(async () => {
    const cfg = cfgRef.current
    const local = dataRef.current
    if (!cfg || !local || syncingRef.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSync((s) => ({ ...s, status: 'offline' }))
      return
    }
    syncingRef.current = true
    setSync((s) => ({ ...s, status: 'syncing' }))
    const startVersion = versionRef.current
    const nowISO = new Date().toISOString()
    try {
      const r = await syncOnce(local, cfg, nowISO)
      const changedMeanwhile = versionRef.current !== startVersion
      setDataState((prev) => {
        if (!prev) return prev
        // если пользователь что-то добавил, пока шла синхронизация, — объединяем, а не затираем
        const next = changedMeanwhile ? mergeData(prev, r.data, nowISO).data : r.data
        storage.save(next)
        return next
      })
      setCfg({ ...cfg, dirty: changedMeanwhile, lastSyncAt: nowISO, lastError: undefined })
      setSync({ configured: true, status: 'idle', lastSyncAt: nowISO, repo: `${cfg.owner}/${cfg.repo}` })
      if (changedMeanwhile) window.setTimeout(() => runSyncRef.current(), 1500)
    } catch (e) {
      const offline = e instanceof NetworkError
      const msg = errorText(e)
      setCfg({ ...cfg, lastError: offline ? undefined : msg })
      setSync((s) => ({ ...s, status: offline ? 'offline' : 'error', error: offline ? undefined : msg }))
    } finally {
      syncingRef.current = false
    }
  }, [setCfg])
  const runSyncRef = useRef(runSync)
  runSyncRef.current = runSync

  const scheduleSync = useCallback((ms = 3000) => {
    if (!cfgRef.current) return
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => runSyncRef.current(), ms)
  }, [])

  // Когда синхронизировать: при открытии, при возврате в приложение, при появлении интернета,
  // раз в минуту, пока приложение на экране, и при уходе из приложения, если есть неотправленное.
  useEffect(() => {
    if (loading || !data || !cfgRef.current) return
    runSyncRef.current()
    const onVisible = () => {
      if (document.visibilityState === 'visible') runSyncRef.current()
      else if (cfgRef.current?.dirty) runSyncRef.current()
    }
    const onOnline = () => runSyncRef.current()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const iv = window.setInterval(() => document.visibilityState === 'visible' && runSyncRef.current(), 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.clearInterval(iv)
    }
    // запускаем один раз после загрузки данных и при подключении синхронизации
  }, [loading, !!data, sync.configured])

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

  /** local = изменение только для этого телефона (снимки, тема) — не требует синхронизации */
  const update = useCallback(
    (fn: (d: AppData) => AppData, local = false) => {
      if (!local) {
        versionRef.current++
        if (cfgRef.current && !cfgRef.current.dirty) setCfg({ ...cfgRef.current, dirty: true })
        scheduleSync()
      }
      setDataState((prev) => {
        if (!prev) return prev
        const next = fn(prev)
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => storage.save(next), 150)
        return next
      })
    },
    [setCfg, scheduleSync],
  )

  // Одноразовый перенос: личные наличные у каждого члена семьи
  useEffect(() => {
    if (!data || data.settings.cashSplit) return
    update((d) => splitCashPerPerson(d, today, new Date().toISOString()))
  }, [data, today, update])

  // Ежедневный снимок «Можно потратить» для блока «Что изменилось»
  useEffect(() => {
    if (!data) return
    const available = availableToSpend(data, today).available
    const snaps = data.snapshots ?? []
    const existing = snaps.find((s) => s.date === today)
    if (existing && existing.available === available) return
    const next = [...snaps.filter((s) => s.date !== today), { date: today, available }].sort((a, b) => a.date.localeCompare(b.date)).slice(-120)
    update((d) => ({ ...d, snapshots: next }), true)
  }, [data, today, update])

  const store = useMemo<Store>(() => {
    // Каждая правка получает время изменения, каждое удаление — «надгробие»: так синхронизация понимает, что новее
    const now = () => new Date().toISOString()
    const stamp = <T,>(x: T): T => ({ ...x, updatedAt: now() })
    const tombstone = (d: AppData, id: string) => [...(d.deleted ?? []).filter((x) => x.id !== id), { id, at: now() }]
    const upsert = <T extends { id: string }>(list: T[], item: T) => {
      const it = stamp(item)
      return list.some((x) => x.id === it.id) ? list.map((x) => (x.id === it.id ? it : x)) : [...list, it]
    }
    const withLearning = (d: AppData, t: Transaction | NewTransaction, learn?: boolean) => {
      if (!(learn && t.categoryId && t.description.trim())) return d.rules
      const next = learnRule(d, t.description, t.categoryId, t.scope, () => newId('rule'))
      return next.map((r) => (d.rules.includes(r) ? r : stamp(r)))
    }

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
        update((d) => ({ ...d, rules: withLearning(d, t, learn), transactions: [...d.transactions, stamp({ ...t, id: newId('tx') })] })),
      updateTransaction: (t, learn) =>
        update((d) => ({ ...d, rules: withLearning(d, t, learn), transactions: d.transactions.map((x) => (x.id === t.id ? stamp(t) : x)) })),
      deleteTransaction: (id) => update((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== id), deleted: tombstone(d, id) })),
      confirmOccurrence: (o, amount, date) =>
        update((d) => ({ ...d, transactions: [...d.transactions, stamp(occurrenceToTransaction(o, newId('tx'), amount, date))] })),
      skipOccurrence: (o) => update((d) => ({ ...d, skipped: [...d.skipped, { recurringId: o.recurring.id, occurrence: o.date }] })),
      confirmAllPast: () =>
        update((d) => {
          const occ = dueOccurrences(d, today).filter((o) => o.recurring.type !== 'income')
          const added = occ.map((o) => stamp(occurrenceToTransaction(o, newId('tx'))))
          const txs = d.transactions.map((t) => (t.status === 'pending' && t.type !== 'income' && t.date <= today ? stamp({ ...t, status: 'posted' as const }) : t))
          return { ...d, transactions: [...txs, ...added] }
        }),
      confirmPending: (id, amount) =>
        update((d) => ({ ...d, transactions: d.transactions.map((x) => (x.id === id ? stamp({ ...x, status: 'posted' as const, date: x.date < today ? x.date : today, ...(amount ? { amount } : {}) }) : x)) })),
      saveRecurring: (r) => update((d) => ({ ...d, recurring: upsert(d.recurring, r) })),
      deleteRecurring: (id) => update((d) => ({ ...d, recurring: d.recurring.filter((x) => x.id !== id), deleted: tombstone(d, id) })),
      saveGoal: (g) => update((d) => ({ ...d, goals: upsert(d.goals, g) })),
      deleteGoal: (id) => update((d) => ({ ...d, goals: d.goals.filter((x) => x.id !== id), deleted: tombstone(d, id) })),
      contributeGoal: (id, amount) =>
        update((d) => ({
          ...d,
          goals: d.goals.map((g) => (g.id === id ? stamp({ ...g, current: Math.max(g.current + amount, 0), contributions: [...(g.contributions ?? []), { id: newId('c'), date: today, amount }] }) : g)),
        })),
      saveAccount: (a) => update((d) => ({ ...d, accounts: upsert(d.accounts, a) })),
      deleteAccount: (id) => update((d) => ({ ...d, accounts: d.accounts.filter((a) => a.id !== id), deleted: tombstone(d, id) })),
      // Остаток «сейчас»: якорь ставится на конец вчерашнего дня с учётом сегодняшних операций,
      // чтобы операции, введённые сегодня позже, продолжали менять баланс.
      setAccountBalance: (id, amount) =>
        update((d) => {
          const todays = d.transactions.filter((t) => t.status === 'posted' && t.date === today).reduce((s, t) => s + effectOn(t, id), 0)
          return {
            ...d,
            accounts: d.accounts.map((a) => (a.id === id ? stamp({ ...a, anchor: { date: addDays(today, -1), amount: amount - todays }, balanceConfidence: 'high' as const }) : a)),
          }
        }),
      saveCategory: (c) => update((d) => ({ ...d, categories: upsert(d.categories, c) })),
      renameMember: (id, name) => update((d) => ({ ...d, members: d.members.map((m) => (m.id === id ? stamp({ ...m, name }) : m)) })),
      // Общие настройки (подушка, конверты) получают время изменения; личные (тема, «чей телефон») — нет
      updateSettings: (s) =>
        update((d) => {
          const personal = ['theme', 'accent', 'me', 'lastBackupAt', 'lastSyncAt']
          const shared = Object.keys(s).some((k) => !personal.includes(k))
          return { ...d, settings: { ...d.settings, ...s, ...(shared ? { updatedAt: now() } : {}) } }
        }, !Object.keys(s).some((k) => !['theme', 'accent', 'me', 'lastBackupAt', 'lastSyncAt'].includes(k))),
      deleteRule: (id) => update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id), deleted: tombstone(d, id) })),
      syncWith: (remote) => {
        if (!data) return { added: 0, updated: 0, removed: 0 }
        const { data: merged, stats } = mergeData(data, migrate(remote), now())
        commit(merged)
        return stats
      },
      sync,
      connectSync: async (c) => {
        const cfg: SyncConfig = { owner: c.owner.trim(), repo: c.repo.trim(), path: DEFAULT_PATH, token: c.token.trim(), password: c.password, dirty: true }
        await checkRepo(refOf(cfg))
        const local = dataRef.current
        if (!local) throw new Error('Нет данных на телефоне')
        const nowISO = now()
        const r = await syncOnce(local, cfg, nowISO)
        commit(r.data)
        setCfg({ ...cfg, dirty: false, lastSyncAt: nowISO })
        setSync({ configured: true, status: 'idle', lastSyncAt: nowISO, repo: `${cfg.owner}/${cfg.repo}` })
        return { created: r.created, stats: r.stats }
      },
      joinFamily: async (c) => {
        const cfg: SyncConfig = { owner: c.owner.trim(), repo: c.repo.trim(), path: DEFAULT_PATH, token: c.token.trim(), password: c.password, dirty: false }
        await checkRepo(refOf(cfg))
        const remote = await fetchRemote(cfg)
        if (!remote) throw new Error('В репозитории пока нет данных. Сначала подключите синхронизацию на телефоне, где данные уже есть.')
        const nowISO = now()
        commit({ ...remote, settings: { ...remote.settings, lastSyncAt: nowISO, lastBackupAt: nowISO } })
        setCfg({ ...cfg, lastSyncAt: nowISO })
        setSync({ configured: true, status: 'idle', lastSyncAt: nowISO, repo: `${cfg.owner}/${cfg.repo}` })
      },
      disconnectSync: () => {
        setCfg(null)
        setSync({ configured: false, status: 'off' })
      },
      syncNow: () => runSyncRef.current(),
      limited: device.limited,
      enableLimited: async (pin) => {
        const next = { limited: true, pinHash: await hashPin(pin) }
        saveDevicePrefs(next)
        setDevice(next)
      },
      disableLimited: async (pin) => {
        if ((await hashPin(pin)) !== device.pinHash) return false
        const next = { limited: false }
        saveDevicePrefs(next)
        setDevice(next)
        return true
      },
      reset: async () => {
        setCfg(null)
        setSync({ configured: false, status: 'off' })
        await storage.clear()
        setDataState(null)
      },
    }
  }, [data, loading, today, commit, update, sync, setCfg, device])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
