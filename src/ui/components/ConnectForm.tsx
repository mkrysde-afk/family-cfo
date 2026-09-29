import { useState } from 'react'
import type { ConnectParams } from '../../state/store'

/**
 * Форма подключения к семейным данным в закрытом репозитории GitHub.
 * Ключ и пароль вводит сам пользователь; они хранятся только на этом телефоне.
 */
export function ConnectForm({ submitLabel, onSubmit, confirmPassword }: {
  submitLabel: string
  onSubmit: (p: ConnectParams) => Promise<void>
  /** просить повторить пароль (при первом подключении, когда пароль придумывается) */
  confirmPassword?: boolean
}) {
  const [repoPath, setRepoPath] = useState('')
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    const m = repoPath.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '').match(/^([\w.-]+)\/([\w.-]+)$/)
    if (!m) return setError('Укажите репозиторий в виде «логин/название», например user/family-cfo-data')
    if (!token.trim()) return setError('Вставьте ключ доступа GitHub')
    if (password.length < 8) return setError('Семейный пароль — не короче 8 символов')
    if (confirmPassword && password !== password2) return setError('Пароли не совпадают')
    setBusy(true)
    try {
      await onSubmit({ owner: m[1], repo: m[2], token, password })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключиться')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="list">
        <div className="field">
          <label htmlFor="cf-repo">Репозиторий</label>
          <input id="cf-repo" placeholder="логин/family-cfo-data" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cf-token">Ключ GitHub</label>
          <input id="cf-token" type="password" placeholder="github_pat_…" autoComplete="off" autoCapitalize="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cf-pass">Семейный пароль</label>
          <input id="cf-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {confirmPassword && (
          <div className="field">
            <label htmlFor="cf-pass2">Ещё раз</label>
            <input id="cf-pass2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </div>
        )}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn primary block" onClick={submit} disabled={busy}>{busy ? 'Подключаю…' : submitLabel}</button>
      <p className="tiny muted" style={{ margin: '8px 4px 0' }}>
        Ключ и пароль сохраняются только на этом телефоне. Данные шифруются семейным паролем до отправки — GitHub видит только шифр.
        Если пароль забыть, прочитать данные в облаке будет невозможно (на телефонах они останутся).
      </p>
    </>
  )
}
