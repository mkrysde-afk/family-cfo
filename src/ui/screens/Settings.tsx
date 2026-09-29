import { useRef, useState } from 'react'
import { accountBalance, eur, formatDate, parseAmount, type Account, type AccountKind, type Category } from '../../engine'
import { BackupError, downloadBackup, parseBackup } from '../../storage/backup'
import { newId, useData, useStore } from '../../state/store'
import { ConfBadge, Segmented, Sheet, Switch, useToast } from '../components/common'

const KIND_LABEL: Record<AccountKind, string> = { bank: 'Карта / счёт', cash: 'Наличные', savings: 'Накопления' }
const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#BA7517', '#534AB7', '#D4537E', '#0F6E56', '#993C1D', '#5F5E5A', '#EF9F27']

function AccountSheet({ edit, onClose }: { edit?: Account; onClose: () => void }) {
  const data = useData()
  const { today, saveAccount, setAccountBalance } = useStore()
  const toast = useToast()
  const current = edit ? accountBalance(edit, data.transactions, today) : 0
  const [name, setName] = useState(edit?.name ?? '')
  const [owner, setOwner] = useState(edit?.owner ?? data.settings.me ?? data.members.find((m) => !m.isFamily)?.id ?? 'family')
  const [kind, setKind] = useState<AccountKind>(edit?.kind ?? 'bank')
  const [balance, setBalance] = useState((current / 100).toFixed(2).replace('.', ','))
  const [archived, setArchived] = useState(edit?.archived ?? false)
  const parsed = balance.trim() === '0' || balance.trim() === '0,00' ? 0 : parseAmount(balance.replace('-', ''))
  const negative = balance.trim().startsWith('-')

  function save() {
    if (!name.trim() || parsed === null) return
    const id = edit?.id ?? newId('acc')
    saveAccount({ ...(edit ?? { anchor: { date: today, amount: 0 } }), id, name: name.trim(), owner, kind, archived } as Account)
    const target = negative ? -parsed : parsed
    if (!edit || target !== current) setAccountBalance(id, target)
    toast('Сохранено')
    onClose()
  }

  return (
    <Sheet title={edit ? 'Источник денег' : 'Новый источник'} onClose={onClose} onDone={save} doneDisabled={!name.trim() || parsed === null}>
      <div className="list">
        <div className="field"><label htmlFor="an">Название</label><input id="an" value={name} placeholder="Карта партнёра" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="ak">Тип</label>
          <select id="ak" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ao">Чей</label>
          <select id="ao" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="ab">Остаток сейчас, €</label><input id="ab" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value.replace(/[^\d.,-]/g, ''))} /></div>
        {edit && <div className="field"><label>В архиве</label><span className="grow" /><Switch checked={archived} onChange={setArchived} label="В архиве" /></div>}
      </div>
      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        Изменение остатка — это корректировка: история операций не меняется, баланс просто начинает считаться от новой суммы.
        {kind === 'savings' && ' Накопления входят в общий капитал, но не в «Можно потратить».'}
      </p>
      {edit?.note && <p className="small muted" style={{ margin: '0 4px 12px' }}>{edit.note}</p>}
      <button className="btn primary block" onClick={save}>Сохранить</button>
    </Sheet>
  )
}

function CategorySheet({ edit, onClose }: { edit?: Category; onClose: () => void }) {
  const { saveCategory } = useStore()
  const toast = useToast()
  const [name, setName] = useState(edit?.name ?? '')
  const [kind, setKind] = useState(edit?.kind ?? 'expense')
  const [essential, setEssential] = useState(edit?.essential ?? false)
  const [personal, setPersonal] = useState(edit?.defaultScope === 'personal')
  const [color, setColor] = useState(edit?.color ?? COLORS[0])
  const [archived, setArchived] = useState(edit?.archived ?? false)
  function save() {
    if (!name.trim()) return
    saveCategory({ ...edit, id: edit?.id ?? newId('cat'), name: name.trim(), kind, essential, defaultScope: personal ? 'personal' : 'family', color, archived })
    toast('Категория сохранена')
    onClose()
  }
  return (
    <Sheet title={edit ? 'Категория' : 'Новая категория'} onClose={onClose} onDone={save} doneDisabled={!name.trim()}>
      {!edit && <div style={{ marginBottom: 12 }}><Segmented value={kind} options={[['expense', 'Расход'], ['income', 'Доход']]} onChange={setKind} /></div>}
      <div className="list">
        <div className="field"><label htmlFor="cn">Название</label><input id="cn" value={name} placeholder="Животные" onChange={(e) => setName(e.target.value)} /></div>
        {kind === 'expense' && <div className="field"><label>Необходимое</label><span className="grow" /><Switch checked={essential} onChange={setEssential} label="Необходимое" /></div>}
        {kind === 'expense' && <div className="field"><label>Обычно личное</label><span className="grow" /><Switch checked={personal} onChange={setPersonal} label="Личное" /></div>}
        {edit && <div className="field"><label>Скрыть</label><span className="grow" /><Switch checked={archived} onChange={setArchived} label="Скрыть" /></div>}
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {COLORS.map((c) => (
          <button key={c} aria-label={`Цвет ${c}`} onClick={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: 16, background: c, border: color === c ? '3px solid var(--text)' : '0' }} />
        ))}
      </div>
      <p className="small muted" style={{ margin: '0 4px 12px' }}>«Необходимое» — продукты, жильё, связь: CFO не предлагает резко их сокращать и учитывает в финансовой подушке.</p>
      <button className="btn primary block" onClick={save}>Сохранить</button>
    </Sheet>
  )
}

export function Settings() {
  const data = useData()
  const store = useStore()
  const { today, updateSettings, renameMember, deleteRule, setData, reset } = store
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [acc, setAcc] = useState<Account | 'new' | null>(null)
  const [cat, setCat] = useState<Category | 'new' | null>(null)
  const userRules = data.rules.filter((r) => r.source === 'user')

  async function exportData() {
    try {
      await downloadBackup(data)
      updateSettings({ lastBackupAt: new Date().toISOString() })
      toast('Резервная копия создана')
    } catch {
      /* пользователь отменил */
    }
  }

  async function importData(file: File) {
    try {
      const next = parseBackup(await file.text())
      if (!confirm(`Заменить текущие данные резервной копией (${next.transactions.length} операций)? Текущие данные будут потеряны.`)) return
      setData(next)
      toast('Данные восстановлены')
    } catch (e) {
      toast(e instanceof BackupError ? e.message : 'Не удалось прочитать файл')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <h1 className="page-title">Настройки</h1>

      <div className="section-title">Оформление</div>
      <div className="card">
        <Segmented value={data.settings.theme} options={[['system', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная'], ['pink', 'Розовая']]} onChange={(theme) => updateSettings({ theme })} />
        <div className="row small" style={{ marginTop: 10 }}><span className="muted">Валюта</span><span>Евро (€)</span></div>
      </div>

      <div className="section-title">Члены семьи</div>
      <div className="list">
        {data.members.filter((m) => !m.isFamily).map((m) => (
          <div className="field" key={m.id}>
            <span className="dot" style={{ background: m.color }} />
            <input aria-label="Имя" defaultValue={m.name} style={{ textAlign: 'left' }} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.name && renameMember(m.id, e.target.value.trim())} />
          </div>
        ))}
      </div>

      <div className="section-title">Источники денег</div>
      <div className="list">
        {data.accounts.map((a) => (
          <button className="list-item" key={a.id} onClick={() => setAcc(a)} style={{ opacity: a.archived ? 0.5 : 1 }}>
            <div className="grow">
              <div className="title">{a.name}</div>
              <div className="sub">{KIND_LABEL[a.kind]} · {data.members.find((m) => m.id === a.owner)?.name}{a.archived ? ' · в архиве' : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="num">{eur(accountBalance(a, data.transactions, today), { cents: true })}</div>
              {a.balanceConfidence === 'low' && <ConfBadge c="low" short />}
            </div>
          </button>
        ))}
        <button className="list-item" onClick={() => setAcc('new')}><span className="title" style={{ color: 'var(--accent)' }}>Добавить источник</span></button>
      </div>

      <div className="section-title">Категории</div>
      <div className="list">
        {(['expense', 'income'] as const).flatMap((k) => data.categories.filter((c) => c.kind === k)).map((c) => (
          <button className="list-item" key={c.id} onClick={() => setCat(c)} style={{ opacity: c.archived ? 0.5 : 1 }}>
            <span className="dot" style={{ background: c.color }} />
            <span className="grow title">{c.name}</span>
            <span className="small muted">{c.kind === 'income' ? 'доход' : c.essential ? 'необходимое' : ''}</span>
          </button>
        ))}
        <button className="list-item" onClick={() => setCat('new')}><span className="title" style={{ color: 'var(--accent)' }}>Добавить категорию</span></button>
      </div>

      {userRules.length > 0 && (
        <>
          <div className="section-title">Запомненные категории</div>
          <div className="list">
            {userRules.map((r) => (
              <div className="list-item" key={r.id}>
                <span className="grow">«{r.keyword}» → {data.categories.find((c) => c.id === r.categoryId)?.name}</span>
                <button className="btn small danger" onClick={() => deleteRule(r.id)}>Забыть</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Резервная копия</div>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          Все данные хранятся только на этом устройстве. Сохраняйте копию в «Файлы» / iCloud Drive хотя бы раз в пару недель.
          {data.settings.lastBackupAt && <> Последняя копия: {formatDate(data.settings.lastBackupAt.slice(0, 10), true)}.</>}
        </p>
        <button className="btn primary block" onClick={exportData}>Сохранить резервную копию</button>
        <button className="btn block" onClick={() => fileRef.current?.click()}>Восстановить из копии</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
        <p className="tiny muted" style={{ margin: 0 }}>Принимается только файл резервной копии Family CFO — не банковские выписки.</p>
      </div>

      {data.meta?.notes && data.meta.notes.length > 0 && (
        <>
          <div className="section-title">Допущения в начальных данных</div>
          <div className="card small">
            <ul style={{ margin: 0, paddingLeft: 18 }} className="stack">
              {data.meta.notes.map((n, i) => <li key={i} className="muted">{n}</li>)}
            </ul>
          </div>
        </>
      )}

      <div className="section-title">Опасная зона</div>
      <div className="card">
        <button className="btn danger block" onClick={async () => {
          if (!confirm('Удалить все данные с этого устройства? Без резервной копии их не восстановить.')) return
          if (!confirm('Точно удалить? Это действие необратимо.')) return
          await reset()
        }}>Сбросить все данные</button>
      </div>

      {acc && <AccountSheet edit={acc === 'new' ? undefined : acc} onClose={() => setAcc(null)} />}
      {cat && <CategorySheet edit={cat === 'new' ? undefined : cat} onClose={() => setCat(null)} />}
    </>
  )
}
