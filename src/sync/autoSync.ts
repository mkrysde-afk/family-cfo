import { mergeData, type AppData, type MergeStats } from '../engine'
import { migrate, syncSnapshot } from '../storage/backup'
import { decryptJSON, encryptJSON, type Envelope } from './crypto'
import { ConflictError, readFile, writeFile, type RepoRef } from './github'

/** Настройки автосинхронизации — хранятся только на этом телефоне и не попадают в резервные копии */
export interface SyncConfig {
  owner: string
  repo: string
  path: string
  token: string
  password: string
  /** есть локальные изменения, ещё не отправленные в облако */
  dirty: boolean
  lastSyncAt?: string
  lastError?: string
}

const KEY = 'family-cfo:autosync:v1'
export const DEFAULT_PATH = 'family-cfo.enc.json'

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SyncConfig) : null
  } catch {
    return null
  }
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg))
  else localStorage.removeItem(KEY)
}

export const refOf = (c: SyncConfig): RepoRef => ({ owner: c.owner, repo: c.repo, path: c.path, token: c.token })

export interface SyncIO {
  read: (ref: RepoRef) => Promise<{ sha: string; text: string } | null>
  write: (ref: RepoRef, text: string, sha: string | undefined, message: string) => Promise<string>
}

export const githubIO: SyncIO = { read: readFile, write: writeFile }

export interface SyncResult {
  data: AppData
  pushed: boolean
  stats: MergeStats
  /** в облаке ещё не было данных — эта копия стала первой */
  created: boolean
}

/** Скачивает и расшифровывает данные семьи (для подключения нового телефона) */
export async function fetchRemote(cfg: SyncConfig, io: SyncIO = githubIO): Promise<AppData | null> {
  const remote = await io.read(refOf(cfg))
  if (!remote) return null
  return migrate((await decryptJSON(JSON.parse(remote.text) as Envelope, cfg.password)) as AppData)
}

/**
 * Один цикл синхронизации:
 * 1) скачать файл из облака и расшифровать;
 * 2) объединить с данными телефона (без потерь, см. engine/sync.ts);
 * 3) если на телефоне были изменения — зашифровать и отправить. Если за это время файл
 *    изменил другой телефон (конфликт версий), повторить с шага 1.
 */
export async function syncOnce(local: AppData, cfg: SyncConfig, nowISO: string, io: SyncIO = githubIO): Promise<SyncResult> {
  const ref = refOf(cfg)
  let current = local
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await io.read(ref)
    let merged = current
    let stats: MergeStats = { added: 0, updated: 0, removed: 0 }
    let salt: string | undefined
    let remoteMissesLocal = !remote
    if (remote) {
      const env = JSON.parse(remote.text) as Envelope
      salt = env.kdf?.salt
      const remoteData = migrate((await decryptJSON(env, cfg.password)) as AppData)
      const m = mergeData(current, remoteData, nowISO)
      merged = m.data
      stats = m.stats
      // есть ли у телефона операции, которых нет в облаке
      const back = mergeData(remoteData, current, nowISO).stats
      remoteMissesLocal = back.added + back.updated + back.removed > 0
    } else {
      merged = { ...current, settings: { ...current.settings, lastSyncAt: nowISO } }
    }

    if (!remote || cfg.dirty || remoteMissesLocal) {
      const env = await encryptJSON(syncSnapshot(merged), cfg.password, salt)
      try {
        await io.write(ref, JSON.stringify(env), remote?.sha, `Синхронизация ${nowISO.slice(0, 16).replace('T', ' ')}`)
        return { data: merged, pushed: true, stats, created: !remote }
      } catch (e) {
        if (e instanceof ConflictError) {
          current = merged
          continue
        }
        throw e
      }
    }
    return { data: merged, pushed: false, stats, created: false }
  }
  throw new ConflictError('Не удалось сохранить: файл постоянно меняется на другом телефоне. Попробуйте ещё раз.')
}
