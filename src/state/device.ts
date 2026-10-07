/**
 * Настройки конкретного телефона (не синхронизируются и не попадают в резервные копии).
 * «Упрощённый режим» — защита от случайных изменений: только просмотр и ввод операций.
 */
export interface DevicePrefs {
  limited: boolean
  /** SHA-256 от PIN — чтобы PIN не хранился открытым текстом */
  pinHash?: string
}

const KEY = 'family-cfo:device:v1'

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DevicePrefs) : { limited: false }
  } catch {
    return { limited: false }
  }
}

export function saveDevicePrefs(p: DevicePrefs): void {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export async function hashPin(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`family-cfo-pin:${pin}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
