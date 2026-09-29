import { describe, expect, it } from 'vitest'
import { emptyData, tx } from '../engine/testData'
import type { AppData } from '../engine'
import { decryptJSON, encryptJSON, WrongPasswordError, type Envelope } from './crypto'
import { ConflictError, type RepoRef } from './github'
import { fetchRemote, syncOnce, type SyncConfig, type SyncIO } from './autoSync'

const FAST = 1000 // в тестах меньше итераций, чтобы не ждать

/** Имитация GitHub: один файл с версией (sha) */
function fakeCloud() {
  let file: { sha: string; text: string } | null = null
  let n = 0
  let conflictOnce = false
  const io: SyncIO = {
    read: async () => (file ? { ...file } : null),
    write: async (_r: RepoRef, text: string, sha: string | undefined) => {
      if (conflictOnce) {
        conflictOnce = false
        throw new ConflictError('conflict')
      }
      if ((file?.sha ?? undefined) !== sha) throw new ConflictError('conflict')
      file = { sha: `v${++n}`, text }
      return file.sha
    },
  }
  return { io, get: () => file, failNextWrite: () => (conflictOnce = true) }
}

const cfg = (dirty = true): SyncConfig => ({ owner: 'o', repo: 'r', path: 'f.json', token: 't', password: 'семейный пароль', dirty })

describe('Шифрование', () => {
  it('расшифровывается тем же паролем и не читается без него', async () => {
    const env = await encryptJSON({ сумма: 2462.11, текст: 'Продукты' }, 'пароль', undefined, FAST)
    expect(env.data).not.toContain('2462')
    expect(await decryptJSON(env, 'пароль')).toEqual({ сумма: 2462.11, текст: 'Продукты' })
    await expect(decryptJSON(env, 'другой')).rejects.toBeInstanceOf(WrongPasswordError)
  })
})

describe('Автосинхронизация двух телефонов', () => {
  it('первый телефон создаёт файл, второй получает данные и добавляет свои', async () => {
    const cloud = fakeCloud()
    const mine: AppData = emptyData()
    mine.transactions.push(tx({ id: 'm1', type: 'expense', amount: 500, date: '2026-10-01', accountId: 'bank', categoryId: 'cafe' }))

    const r1 = await syncOnce(mine, cfg(), '2026-10-01T10:00:00Z', cloud.io)
    expect(r1.created).toBe(true)
    expect(r1.pushed).toBe(true)
    // в облаке — только шифр
    expect(cloud.get()!.text).not.toContain('cafe')

    // второй телефон подключается и получает всё
    const hers = (await fetchRemote(cfg(), cloud.io))!
    expect(hers.transactions.map((t) => t.id)).toEqual(['m1'])
    hers.transactions.push(tx({ id: 'h1', type: 'expense', amount: 700, date: '2026-10-01', accountId: 'bank', categoryId: 'groceries', updatedAt: '2026-10-01T11:00:00Z' }))
    await syncOnce(hers, cfg(), '2026-10-01T11:00:00Z', cloud.io)

    // первый телефон при следующем открытии видит трату второго
    const r3 = await syncOnce(r1.data, cfg(false), '2026-10-01T12:00:00Z', cloud.io)
    expect(r3.data.transactions.map((t) => t.id).sort()).toEqual(['h1', 'm1'])
    expect(r3.stats.added).toBe(1)
    expect(r3.pushed).toBe(false) // ничего нового у первого — лишней записи нет
  })

  it('при одновременной записи с двух телефонов ничего не теряется', async () => {
    const cloud = fakeCloud()
    const base = emptyData()
    await syncOnce(base, cfg(), '2026-10-01T09:00:00Z', cloud.io)
    const a = structuredClone(base)
    const b = structuredClone(base)
    a.transactions.push(tx({ id: 'a1', type: 'expense', amount: 100, date: '2026-10-01', accountId: 'bank', categoryId: 'cafe' }))
    b.transactions.push(tx({ id: 'b1', type: 'expense', amount: 200, date: '2026-10-01', accountId: 'bank', categoryId: 'cafe' }))
    await syncOnce(a, cfg(), '2026-10-01T10:00:00Z', cloud.io)
    cloud.failNextWrite() // другой телефон «успел» записать раньше — конфликт версий
    const rb = await syncOnce(b, cfg(), '2026-10-01T10:00:01Z', cloud.io)
    expect(rb.data.transactions.map((t) => t.id).sort()).toEqual(['a1', 'b1'])
    const final = (await fetchRemote(cfg(), cloud.io))!
    expect(final.transactions.map((t) => t.id).sort()).toEqual(['a1', 'b1'])
  })

  it('неверный семейный пароль не портит данные в облаке', async () => {
    const cloud = fakeCloud()
    await syncOnce(emptyData(), cfg(), '2026-10-01T09:00:00Z', cloud.io)
    const before = cloud.get()!.sha
    await expect(syncOnce(emptyData(), { ...cfg(), password: 'не тот' }, '2026-10-01T10:00:00Z', cloud.io)).rejects.toBeInstanceOf(WrongPasswordError)
    expect(cloud.get()!.sha).toBe(before)
  })

  it('в облако не уходят личные настройки телефона', async () => {
    const cloud = fakeCloud()
    const d = emptyData()
    d.settings.me = 'a'
    d.settings.theme = 'pink'
    await syncOnce(d, cfg(), '2026-10-01T09:00:00Z', cloud.io)
    const env = JSON.parse(cloud.get()!.text) as Envelope
    const stored = (await decryptJSON(env, cfg().password)) as AppData
    expect(stored.settings.me).toBeUndefined()
    expect(stored.settings.theme).toBe('system')
  })
})
