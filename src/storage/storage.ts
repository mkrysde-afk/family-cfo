import type { AppData } from '../engine'

/**
 * Слой хранения. Интерфейс намеренно минимальный, чтобы позже заменить
 * localStorage на IndexedDB или сервер синхронизации без изменения приложения.
 */
export interface StorageAdapter {
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
  clear(): Promise<void>
}

const KEY = 'family-cfo:data:v1'

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<AppData | null> {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as AppData) : null
    } catch {
      return null
    }
  }

  async save(data: AppData): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(data))
  }

  async clear(): Promise<void> {
    localStorage.removeItem(KEY)
  }
}

/** Просим браузер не удалять данные при нехватке места (Safari учитывает для PWA на экране «Домой») */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* не поддерживается */
  }
  return false
}

export const storage: StorageAdapter = new LocalStorageAdapter()
