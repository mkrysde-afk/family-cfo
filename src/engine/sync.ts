import type { AppData, Goal, Settings, Transaction } from './types'

/**
 * Синхронизация двух копий данных (например, двух телефонов через общий файл в iCloud).
 * Без сервера: каждый телефон объединяет свою копию с общим файлом и сохраняет результат обратно.
 *
 * Правила:
 * — записи объединяются по id; если запись есть в обеих копиях — остаётся более свежая (updatedAt);
 * — удалённые записи (deleted) удаляются и во второй копии, если удаление новее правки;
 * — регулярный платёж, подтверждённый на обоих телефонах, остаётся один (recurringId + дата);
 * — пополнения целей с разных телефонов складываются;
 * — личные настройки (тема, «чей телефон», даты копий) и снимки остаются локальными.
 */

export interface MergeStats {
  added: number
  updated: number
  removed: number
}

type WithId = { id: string; updatedAt?: string }

const ts = (x?: string) => (x ? Date.parse(x) || 0 : 0)

/** Настройки, которые принадлежат телефону, а не семье */
const LOCAL_SETTINGS: (keyof Settings)[] = ['theme', 'accent', 'me', 'lastBackupAt', 'lastSyncAt']

function mergeList<T extends WithId>(local: T[], remote: T[], deleted: Map<string, number>, stats: MergeStats, count: boolean): T[] {
  const out = new Map<string, T>()
  for (const x of local) out.set(x.id, x)
  for (const r of remote) {
    const l = out.get(r.id)
    if (!l) {
      out.set(r.id, r)
      if (count) stats.added++
    } else if (ts(r.updatedAt) > ts(l.updatedAt)) {
      out.set(r.id, r)
      if (count) stats.updated++
    }
  }
  for (const [id, x] of out) {
    const del = deleted.get(id)
    if (del !== undefined && del >= ts(x.updatedAt)) {
      out.delete(id)
      if (count && local.some((l) => l.id === id)) stats.removed++
    }
  }
  return [...out.values()]
}

/** Пополнения цели с двух телефонов складываются, а не перезаписывают друг друга */
function mergeGoals(local: Goal[], remote: Goal[], merged: Goal[]): Goal[] {
  return merged.map((g) => {
    const other = [...local, ...remote].filter((x) => x.id === g.id && x !== g)
    const seen = new Set((g.contributions ?? []).map((c) => c.id).filter(Boolean))
    let current = g.current
    const contributions = [...(g.contributions ?? [])]
    for (const o of other) {
      for (const c of o.contributions ?? []) {
        if (!c.id || seen.has(c.id)) continue
        seen.add(c.id)
        contributions.push(c)
        current += c.amount
      }
    }
    return contributions.length === (g.contributions ?? []).length ? g : { ...g, current: Math.max(current, 0), contributions }
  })
}

/** Один регулярный платёж за одну дату — одна операция, даже если подтвердили на двух телефонах */
function dedupeOccurrences(txs: Transaction[]): Transaction[] {
  const byKey = new Map<string, Transaction>()
  const out: Transaction[] = []
  for (const t of txs) {
    if (!t.recurringId || !t.occurrence) {
      out.push(t)
      continue
    }
    const key = `${t.recurringId}|${t.occurrence}`
    const prev = byKey.get(key)
    if (!prev) byKey.set(key, t)
    else if (ts(t.updatedAt) > ts(prev.updatedAt) || (ts(t.updatedAt) === ts(prev.updatedAt) && t.id < prev.id)) byKey.set(key, t)
  }
  return [...out, ...byKey.values()]
}

export function mergeData(local: AppData, remote: AppData, nowISO: string): { data: AppData; stats: MergeStats } {
  const stats: MergeStats = { added: 0, updated: 0, removed: 0 }
  const tomb = new Map<string, number>()
  for (const d of [...(local.deleted ?? []), ...(remote.deleted ?? [])]) tomb.set(d.id, Math.max(tomb.get(d.id) ?? 0, ts(d.at)))

  const transactions = dedupeOccurrences(mergeList(local.transactions, remote.transactions, tomb, stats, true))
  const goalsMerged = mergeList(local.goals, remote.goals, tomb, stats, false)

  const skippedKeys = new Set<string>()
  const skipped = [...local.skipped, ...remote.skipped].filter((s) => {
    const k = `${s.recurringId}|${s.occurrence}`
    if (skippedKeys.has(k)) return false
    skippedKeys.add(k)
    return true
  })

  // Общие настройки — из более свежей копии; личные — всегда свои
  const sharedFrom = ts(remote.settings.updatedAt) > ts(local.settings.updatedAt) ? remote.settings : local.settings
  const settings: Settings = { ...sharedFrom }
  for (const k of LOCAL_SETTINGS) (settings as unknown as Record<string, unknown>)[k] = local.settings[k]
  settings.lastSyncAt = nowISO

  const deleted = [...tomb.entries()].map(([id, at]) => ({ id, at: new Date(at).toISOString() }))

  return {
    data: {
      ...local,
      members: mergeList(local.members, remote.members, tomb, stats, false),
      accounts: mergeList(local.accounts, remote.accounts, tomb, stats, false),
      categories: mergeList(local.categories, remote.categories, tomb, stats, false),
      transactions,
      recurring: mergeList(local.recurring, remote.recurring, tomb, stats, false),
      skipped,
      goals: mergeGoals(local.goals, remote.goals, goalsMerged),
      debts: mergeList(local.debts, remote.debts, tomb, stats, false),
      rules: mergeList(local.rules, remote.rules, tomb, stats, false),
      settings,
      deleted,
      snapshots: local.snapshots,
      meta: local.meta,
    },
    stats,
  }
}
