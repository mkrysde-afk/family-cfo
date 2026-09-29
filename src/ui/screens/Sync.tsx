import { useRef, useState } from 'react'
import { type MergeStats } from '../../engine'
import { BackupError, downloadBackup, parseBackup, SYNC_FILE_NAME, syncSnapshot } from '../../storage/backup'
import { useData, useStore } from '../../state/store'
import { Initial, useToast } from '../components/common'

function ago(iso?: string): string {
  if (!iso) return 'ещё не было'
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  if (min < 60 * 24) return `${Math.round(min / 60)} ч назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/**
 * Синхронизация двух телефонов через общий файл в iCloud Drive — без сервера.
 * Шаг 1: выбрать общий файл → данные объединяются. Шаг 2: сохранить объединённый файл обратно.
 */
export function Sync() {
  const data = useData()
  const { updateSettings, syncWith } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<MergeStats | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const people = data.members.filter((m) => !m.isFamily)
  const me = people.find((m) => m.id === data.settings.me)

  async function load(file: File) {
    try {
      const remote = parseBackup(await file.text())
      const stats = syncWith(remote)
      setResult(stats)
      setStep(2)
    } catch (e) {
      toast(e instanceof BackupError ? e.message : 'Не удалось прочитать файл')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    try {
      await downloadBackup(syncSnapshot(data), SYNC_FILE_NAME)
      updateSettings({ lastSyncAt: new Date().toISOString() })
      toast('Общий файл сохранён')
      setStep(1)
      setResult(null)
    } catch {
      /* отменено */
    }
  }

  return (
    <>
      <h1 className="page-title">Синхронизация</h1>
      <p className="page-sub">Общие данные для двух телефонов через папку iCloud — без сервера.</p>

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

      <div className="section-title">Синхронизировать</div>
      <div className="card stack">
        <div className="row small"><span className="muted">Последняя синхронизация</span><span>{ago(data.settings.lastSyncAt)}</span></div>
        <button className={`btn block ${step === 1 ? 'primary' : ''}`} onClick={() => fileRef.current?.click()}>
          1. Открыть общий файл и объединить
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        {result && (
          <p className="small good" style={{ margin: 0 }}>
            Объединено: новых операций {result.added}, изменённых {result.updated}, удалённых {result.removed}.
          </p>
        )}
        <button className={`btn block ${step === 2 ? 'primary' : ''}`} onClick={save}>
          2. Сохранить общий файл
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>
          При сохранении выберите «Сохранить в Файлы» → общую папку → <b>«Заменить»</b>. Файл: {SYNC_FILE_NAME}.
          Если оба телефона внесли траты одновременно, ничего не потеряется — всё соберётся при следующей синхронизации.
        </p>
      </div>

      <div className="section-title">Первая настройка (один раз)</div>
      <div className="card small">
        <ol style={{ margin: 0, paddingLeft: 18 }} className="stack">
          <li>В приложении «Файлы» → iCloud Drive создайте папку <b>Family CFO</b>. Нажмите на неё долго → «Поделиться» → «Общий доступ» → пригласите второго человека.</li>
          <li>На этом телефоне нажмите «2. Сохранить общий файл» и сохраните его в эту папку.</li>
          <li>На втором телефоне: откройте сайт в Safari → «На экран Домой» → «Загрузить мои данные» → выберите <b>{SYNC_FILE_NAME}</b> из общей папки.</li>
          <li>На втором телефоне: «Синхронизация» → «Чей это телефон», а в Настройках — своя тема (например, «Розовая»).</li>
          <li>Дальше каждый раз: <b>1. Открыть</b> → <b>2. Сохранить</b>. Например, вечером или перед тем, как смотреть цифры.</li>
        </ol>
      </div>

      <div className="card small muted">
        {people.map((m) => <span key={m.id} style={{ marginRight: 8 }}><Initial name={m.name} color={m.color} size={20} /></span>)}
        Тема и «чей телефон» у каждого свои и не синхронизируются. Операции, цели, конверты и счета — общие.
      </div>
    </>
  )
}
