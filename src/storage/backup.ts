import type { AppData } from '../engine'
import { addDays, today } from '../engine'

/**
 * Резервная копия = всё состояние приложения в JSON.
 * Это НЕ импорт банковских выписок: принимается только файл, созданный этим приложением.
 */
export function backupFileName(): string {
  return `family-cfo-backup-${today()}.json`
}

export function serializeBackup(data: AppData): string {
  return JSON.stringify({ app: 'family-cfo', exportedAt: new Date().toISOString(), data }, null, 1)
}

export class BackupError extends Error {}

export function parseBackup(text: string): AppData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('Файл повреждён или это не резервная копия Family CFO.')
  }
  const wrapper = parsed as { app?: string; data?: AppData }
  const data = (wrapper && wrapper.app === 'family-cfo' ? wrapper.data : parsed) as AppData
  if (!data || data.version !== 1) throw new BackupError('Это не резервная копия Family CFO.')
  const arrays: (keyof AppData)[] = ['members', 'accounts', 'categories', 'transactions', 'recurring', 'goals', 'debts', 'rules']
  for (const k of arrays) {
    if (!Array.isArray(data[k])) throw new BackupError(`В резервной копии нет раздела «${k}».`)
  }
  if (!data.settings) throw new BackupError('В резервной копии нет настроек.')
  return migrate(data)
}

/** Заполняет поля, появившиеся в новых версиях */
export function migrate(data: AppData): AppData {
  return {
    ...data,
    skipped: data.skipped ?? [],
    snapshots: data.snapshots ?? [],
    settings: Object.assign({ theme: 'system', currency: 'EUR', savingsTarget: 0, coverage: [] }, data.settings),
  }
}

/** Скачивание файла. На iPhone открывает меню «Поделиться» → «Сохранить в Файлы». */
export async function downloadBackup(data: AppData): Promise<void> {
  const text = serializeBackup(data)
  const name = backupFileName()
  const file = new File([text], name, { type: 'application/json' })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: 'Family CFO — резервная копия' })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function emptyAppData(todayISO: string): AppData {
  // остаток задаётся на конец вчерашнего дня: сегодняшние операции уже меняют баланс
  const anchorDate = addDays(todayISO, -1)
  return {
    version: 1,
    members: [
      { id: 'me', name: 'Я', color: '#378ADD' },
      { id: 'partner', name: 'Партнёр', color: '#D4537E' },
      { id: 'family', name: 'Семья', isFamily: true, color: '#1D9E75' },
    ],
    accounts: [
      { id: 'my-bank', name: 'Моя карта', owner: 'me', kind: 'bank', anchor: { date: anchorDate, amount: 0 } },
      { id: 'partner-bank', name: 'Карта партнёра', owner: 'partner', kind: 'bank', anchor: { date: anchorDate, amount: 0 } },
      { id: 'cash', name: 'Наличные', owner: 'family', kind: 'cash', anchor: { date: anchorDate, amount: 0 } },
      { id: 'savings', name: 'Накопления', owner: 'family', kind: 'savings', anchor: { date: anchorDate, amount: 0 } },
    ],
    categories: [
      { id: 'housing', name: 'Жильё', kind: 'expense', essential: true, defaultScope: 'family', color: '#378ADD' },
      { id: 'utilities', name: 'Коммунальные и дом', kind: 'expense', essential: true, defaultScope: 'family', color: '#85B7EB' },
      { id: 'groceries', name: 'Продукты и быт', kind: 'expense', essential: true, envelope: 'need', defaultScope: 'family', color: '#1D9E75' },
      { id: 'car', name: 'Авто и бензин', kind: 'expense', essential: true, envelope: 'need', defaultScope: 'family', color: '#BA7517' },
      { id: 'phone', name: 'Связь', kind: 'expense', essential: true, defaultScope: 'family', color: '#534AB7' },
      { id: 'kids', name: 'Дети', kind: 'expense', essential: true, defaultScope: 'family', color: '#ED93B1' },
      { id: 'health', name: 'Здоровье', kind: 'expense', essential: true, envelope: 'need', defaultScope: 'family', color: '#5DCAA5' },
      { id: 'cafe', name: 'Кафе и доставка', kind: 'expense', envelope: 'want', defaultScope: 'family', color: '#D85A30' },
      { id: 'shopping', name: 'Покупки', kind: 'expense', envelope: 'want', defaultScope: 'family', color: '#F0997B' },
      { id: 'leisure', name: 'Отдых', kind: 'expense', envelope: 'want', defaultScope: 'family', color: '#0F6E56' },
      { id: 'other', name: 'Прочее', kind: 'expense', envelope: 'want', defaultScope: 'family', color: '#D3D1C7' },
      { id: 'salary', name: 'Зарплата', kind: 'income', color: '#639922' },
      { id: 'other-income', name: 'Прочий доход', kind: 'income', color: '#C0DD97' },
    ],
    transactions: [],
    recurring: [],
    skipped: [],
    goals: [{ id: 'goal-emergency', name: 'Финансовая подушка', target: 300000, current: 0, reserve: true, emergency: true }],
    debts: [],
    rules: [],
    snapshots: [],
    settings: { theme: 'system', currency: 'EUR', savingsTarget: 0, coverage: [], trackingStart: todayISO },
    meta: { createdAt: new Date().toISOString(), source: 'Пустой старт' },
  }
}
