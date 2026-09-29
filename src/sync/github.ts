/**
 * Хранение зашифрованного файла в закрытом репозитории GitHub (REST API «contents»).
 * Ключ доступа — fine-grained token только на этот репозиторий с правом Contents: read & write.
 */

export interface RepoRef {
  owner: string
  repo: string
  path: string
  token: string
}

export class AuthError extends Error {}
export class ConflictError extends Error {}
export class NetworkError extends Error {}

const API = 'https://api.github.com'

function headers(ref: RepoRef): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${ref.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

const url = (ref: RepoRef) => `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${ref.path.split('/').map(encodeURIComponent).join('/')}`

async function call(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, cache: 'no-store' })
  } catch {
    throw new NetworkError('Нет соединения с GitHub')
  }
}

function check(res: Response, what: string): void {
  if (res.status === 401 || res.status === 403) throw new AuthError('Ключ доступа не подходит или у него нет прав на этот репозиторий')
  if (res.status === 409 || res.status === 422) throw new ConflictError('Файл изменился на другом телефоне')
  if (!res.ok) throw new Error(`${what}: ошибка GitHub ${res.status}`)
}

/** Проверяет, что репозиторий доступен с этим ключом */
export async function checkRepo(ref: RepoRef): Promise<void> {
  const res = await call(`${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`, { headers: headers(ref) })
  if (res.status === 404) throw new AuthError('Репозиторий не найден или ключ не даёт к нему доступа')
  check(res, 'Проверка репозитория')
}

/** Читает файл. null — файла ещё нет. */
export async function readFile(ref: RepoRef): Promise<{ sha: string; text: string } | null> {
  const res = await call(`${url(ref)}?t=${Date.now()}`, { headers: headers(ref) })
  if (res.status === 404) return null
  check(res, 'Чтение')
  const json = (await res.json()) as { sha: string; content?: string; encoding?: string; download_url?: string }
  if (json.content && json.encoding === 'base64') return { sha: json.sha, text: atob(json.content.replace(/\s/g, '')) }
  // файлы больше 1 МБ API отдаёт без содержимого — читаем «сырой» вариант
  const raw = await call(`${url(ref)}?t=${Date.now()}`, { headers: { ...headers(ref), Accept: 'application/vnd.github.raw' } })
  check(raw, 'Чтение')
  return { sha: json.sha, text: await raw.text() }
}

/** Записывает файл. sha — версия, которую мы видели (для защиты от перезаписи чужих изменений). */
export async function writeFile(ref: RepoRef, text: string, sha: string | undefined, message: string): Promise<string> {
  const res = await call(url(ref), {
    method: 'PUT',
    headers: { ...headers(ref), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: btoa(text), ...(sha ? { sha } : {}) }),
  })
  check(res, 'Запись')
  const json = (await res.json()) as { content: { sha: string } }
  return json.content.sha
}
