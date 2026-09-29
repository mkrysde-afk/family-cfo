import { useRef, useState } from 'react'
import { type MergeStats } from '../../engine'
import { BackupError, downloadBackup, parseBackup, SYNC_FILE_NAME, syncSnapshot } from '../../storage/backup'
import { useData, useStore } from '../../state/store'
import { ConnectForm } from '../components/ConnectForm'
import { useToast } from '../components/common'

export function ago(iso?: string): string {
  if (!iso) return 'ещё не было'
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  if (min < 60 * 24) return `${Math.round(min / 60)} ч назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

const STATUS: Record<string, string> = {
  idle: 'Включена',
  syncing: 'Синхронизирую…',
  offline: 'Нет интернета — отправлю, когда появится',
  error: 'Ошибка',
  off: 'Выключена',
}

export function Sync() {
  const data = useData()
  const { updateSettings, syncWith, sync, connectSync, disconnectSync, syncNow } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<MergeStats | null>(null)
  const people = data.members.filter((m) => !m.isFamily)
  const me = people.find((m) => m.id === data.settings.me)

  async function loadFile(file: File) {
    try {
      setResult(syncWith(parseBackup(await file.text())))
    } catch (e) {
      toast(e instanceof BackupError ? e.message : 'Не удалось прочитать файл')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <h1 className="page-title">Синхронизация</h1>
      <p className="page-sub">Общие данные на двух телефонах. Работает сама: при открытии приложения и после каждой траты.</p>

      <div className="section-title">Чей это телефон</div>
      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          {people.map((m) => (
            <button key={m.id} className="btn grow" onClick={() => updateSettings({ me: m.id })}
              style={data.settings.me === m.id ? { background: m.color, color: '#fff' } : undefined}>
              {m.name}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {me ? `В новых операциях на этом телефоне «Кто платит» по умолчанию — ${me.name}.` : 'Выберите — так в новых операциях сразу будет стоять нужный человек.'}
        </p>
      </div>

      <div className="section-title">Автоматическая синхронизация</div>
      {sync.configured ? (
        <div className="card stack">
          <div className="row"><span className="muted">Статус</span><b className={sync.status === 'error' ? 'bad' : sync.status === 'offline' ? 'warn' : 'good'}>{STATUS[sync.status]}</b></div>
          <div className="row small"><span className="muted">Последняя синхронизация</span><span>{ago(sync.lastSyncAt)}</span></div>
          <div className="row small"><span className="muted">Хранилище</span><span className="ellipsis">{sync.repo} (закрытый, зашифровано)</span></div>
          {sync.error && <p className="small bad" style={{ margin: 0 }}>{sync.error}</p>}
          <button className="btn primary block" onClick={syncNow} disabled={sync.status === 'syncing'}>Синхронизировать сейчас</button>
          <button className="btn block danger" onClick={() => { if (confirm('Отключить синхронизацию на этом телефоне? Данные на телефоне и в облаке останутся.')) disconnectSync() }}>
            Отключить на этом телефоне
          </button>
        </div>
      ) : (
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}>
            Подключите закрытый репозиторий GitHub — и данные будут сами обновляться на обоих телефонах.
            На первом телефоне придумайте семейный пароль; на втором введите тот же.
          </p>
          <ConnectForm
            confirmPassword
            submitLabel="Подключить"
            onSubmit={async (p) => {
              const r = await connectSync(p)
              toast(r.created ? 'Подключено: данные этого телефона отправлены в облако' : `Подключено: объединено, новых операций ${r.stats.added}`)
            }}
          />
        </div>
      )}

      {!sync.configured && (
        <>
          <div className="section-title">Как подключить (один раз)</div>
          <div className="card small">
            <ol style={{ margin: 0, paddingLeft: 18 }} className="stack">
              <li>Закрытый репозиторий для данных уже создан: <b>family-cfo-data</b> в вашем GitHub.</li>
              <li>
                Создайте ключ доступа: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com → Fine-grained token</a>.
                Название — «Family CFO», срок — 1 год, <b>Repository access → Only select repositories → family-cfo-data</b>,
                <b> Permissions → Contents → Read and write</b>. Нажмите «Generate token» и скопируйте ключ.
              </li>
              <li>Вставьте репозиторий, ключ и придумайте семейный пароль → «Подключить».</li>
              <li>Второй телефон: открыть сайт → «На экран Домой» → <b>«Подключиться к семейным данным»</b> → тот же репозиторий, ключ и пароль.</li>
            </ol>
          </div>
        </>
      )}

      <details className="card" style={{ marginTop: 12 }}>
        <summary className="card-title" style={{ cursor: 'pointer' }}>Через файл (без интернета)</summary>
        <p className="small muted">Запасной способ: общий файл {SYNC_FILE_NAME} в папке iCloud.</p>
        <div className="stack">
          <button className="btn block" onClick={() => fileRef.current?.click()}>Открыть файл и объединить</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          {result && <p className="small good" style={{ margin: 0 }}>Объединено: новых {result.added}, изменённых {result.updated}, удалённых {result.removed}.</p>}
          <button className="btn block" onClick={async () => { try { await downloadBackup(syncSnapshot(data), SYNC_FILE_NAME); toast('Файл сохранён') } catch { /* отменено */ } }}>
            Сохранить файл
          </button>
        </div>
      </details>
    </>
  )
}
