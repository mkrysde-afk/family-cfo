/**
 * Шифрование данных семьи перед отправкой в облако (WebCrypto, без внешних библиотек).
 * AES-256-GCM, ключ из семейного пароля через PBKDF2-SHA-256 (310 000 итераций).
 * Сервер хранит только зашифрованный текст и не может его прочитать.
 */

export interface Envelope {
  app: 'family-cfo'
  format: 1
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: 'AES-GCM'
  iv: string
  gzip: boolean
  data: string
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Семейный пароль не подходит к этим данным')
  }
}

export const PBKDF2_ITERATIONS = 310_000

const te = new TextEncoder()
const td = new TextDecoder()

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

// Ключ выводится долго (специально) — кэшируем в памяти на время работы приложения
const keyCache = new Map<string, Promise<CryptoKey>>()

function deriveKey(password: string, salt: string, iterations: number): Promise<CryptoKey> {
  const id = `${salt}|${iterations}|${password}`
  let p = keyCache.get(id)
  if (!p) {
    p = crypto.subtle
      .importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then((base) =>
        crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
      )
    keyCache.set(id, p)
  }
  return p
}

/** Шифрует объект. salt можно передать, чтобы переиспользовать ключ (соль не секретна). */
export async function encryptJSON(value: unknown, password: string, salt?: string, iterations = PBKDF2_ITERATIONS): Promise<Envelope> {
  const s = salt ?? toB64(crypto.getRandomValues(new Uint8Array(16)))
  const key = await deriveKey(password, s, iterations)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  let plain: Uint8Array<ArrayBuffer> = te.encode(JSON.stringify(value))
  const gzip = canGzip()
  if (gzip) plain = await pipe(plain, new CompressionStream('gzip'))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  return {
    app: 'family-cfo',
    format: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: s },
    cipher: 'AES-GCM',
    iv: toB64(iv),
    gzip,
    data: toB64(ct),
  }
}

export async function decryptJSON(env: Envelope, password: string): Promise<unknown> {
  if (env?.app !== 'family-cfo' || env.format !== 1) throw new Error('Это не файл синхронизации Family CFO')
  const key = await deriveKey(password, env.kdf.salt, env.kdf.iterations)
  let plain: Uint8Array<ArrayBuffer>
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.data)))
  } catch {
    throw new WrongPasswordError()
  }
  if (env.gzip) plain = await pipe(plain, new DecompressionStream('gzip'))
  return JSON.parse(td.decode(plain))
}
