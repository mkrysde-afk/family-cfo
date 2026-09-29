import { useEffect, useRef, useState } from 'react'
import { today as todayFn } from '../engine'
import { BackupError, emptyAppData, parseBackup } from '../storage/backup'
import { useStore } from '../state/store'
import { Icons, useToast } from './components/common'
import { TransactionSheet } from './components/TransactionSheet'
import { Budget } from './screens/Budget'
import { Cfo } from './screens/Cfo'
import { Family } from './screens/Family'
import { Goals } from './screens/Goals'
import { Home } from './screens/Home'
import { Settings } from './screens/Settings'
import { Sync } from './screens/Sync'
import { Transactions } from './screens/Transactions'

export type Route = 'home' | 'cfo' | 'tx' | 'more' | 'budget' | 'goals' | 'family' | 'sync' | 'settings'
const ROUTES: Route[] = ['home', 'cfo', 'tx', 'more', 'budget', 'goals', 'family', 'sync', 'settings']
const MORE: Route[] = ['more', 'budget', 'goals', 'family', 'sync', 'settings']

function readRoute(): Route {
  const r = location.hash.replace('#/', '') as Route
  return ROUTES.includes(r) ? r : 'home'
}

function useTheme(theme: 'system' | 'light' | 'dark' | 'pink' | undefined) {
  useEffect(() => {
    const pink = theme === 'pink'
    document.documentElement.dataset.accent = pink ? 'pink' : 'blue'
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches) || (theme === undefined && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : pink ? '#fbeff4' : '#f2f2f7')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function Onboarding() {
  const { setData } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [devSeed, setDevSeed] = useState(false)

  useEffect(() => {
    // Только при локальной разработке: начальные данные из папки private/
    if (import.meta.env.DEV) fetch('/__dev-seed.json', { method: 'HEAD' }).then((r) => setDevSeed(r.ok)).catch(() => {})
  }, [])

  async function restore(file: File) {
    try {
      setData(parseBackup(await file.text()))
      toast('Данные загружены')
    } catch (e) {
      toast(e instanceof BackupError ? e.message : 'Не удалось прочитать файл')
    }
  }

  return (
    <div className="onboarding">
      <h1>Family CFO</h1>
      <p className="muted">Сколько денег у семьи, сколько из них можно потратить и что будет в конце месяца.</p>
      <div className="stack" style={{ marginTop: 28 }}>
        <button className="btn primary block" onClick={() => fileRef.current?.click()}>Загрузить мои данные</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        {devSeed && (
          <button className="btn block" onClick={async () => setData(parseBackup(await (await fetch('/__dev-seed.json')).text()))}>
            Начальные данные (локально)
          </button>
        )}
        <button className="btn block" onClick={() => setData(emptyAppData(todayFn()))}>Начать с нуля</button>
      </div>
      <p className="small muted" style={{ marginTop: 20 }}>
        «Загрузить мои данные» — файл резервной копии Family CFO (.json). Данные хранятся только на этом устройстве и никуда не отправляются.
      </p>
    </div>
  )
}

const MORE_ITEMS: { route: Route; title: string; sub: string; icon: keyof typeof Icons; color: string }[] = [
  { route: 'budget', title: 'Бюджет', sub: 'Факт, обычно, рекомендовано', icon: 'budget', color: '#378ADD' },
  { route: 'goals', title: 'Цели и долги', sub: 'Подушка, цели, займы', icon: 'goals', color: '#1D9E75' },
  { route: 'family', title: 'Семья', sub: 'Вклад каждого', icon: 'family', color: '#D4537E' },
  { route: 'sync', title: 'Синхронизация', sub: 'Общие данные с семьёй', icon: 'repeat', color: '#0F6E56' },
  { route: 'settings', title: 'Настройки', sub: 'Тема, счета, копия', icon: 'settings', color: '#8E8E93' },
]

function More({ go }: { go: (r: Route) => void }) {
  return (
    <>
      <h1 className="page-title">Ещё</h1>
      <div className="list">
        {MORE_ITEMS.map((m) => (
          <button className="list-item" key={m.route} onClick={() => go(m.route)}>
            <span className="icon-circle" style={{ background: m.color, padding: 7 }}>{Icons[m.icon]}</span>
            <div className="grow"><div className="title">{m.title}</div><div className="sub">{m.sub}</div></div>
            <span className="faint">{Icons.chevron}</span>
          </button>
        ))}
      </div>
    </>
  )
}

export function App() {
  const { data, loading } = useStore()
  const [route, setRoute] = useState<Route>(readRoute())
  const [adding, setAdding] = useState(false)
  useTheme(data?.settings.theme)

  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const go = (r: Route) => {
    location.hash = `#/${r}`
    window.scrollTo({ top: 0 })
  }

  if (loading) return null
  if (!data) return <Onboarding />

  const sub = MORE.includes(route) && route !== 'more'
  // Напоминание, если копии не было 14 дней (отсчёт — от последней копии или от загрузки данных)
  const lastSafe = data.settings.lastBackupAt ?? data.meta?.createdAt
  const needBackup = !!lastSafe && (Date.now() - Date.parse(lastSafe)) / 864e5 > 14
  // Напоминание о синхронизации — только если ею уже пользуются
  const lastSync = data.settings.lastSyncAt
  const needSync = !!lastSync && (Date.now() - Date.parse(lastSync)) / 864e5 > 2

  return (
    <>
      <main className="app">
        {sub && (
          <button className="linklike" style={{ display: 'flex', alignItems: 'center', gap: 2, margin: '0 0 4px -4px' }} onClick={() => go('more')}>
            {Icons.left} Ещё
          </button>
        )}
        {needSync && route === 'home' && (
          <button className="banner" onClick={() => go('sync')}>
            <span className="grow">Давно не синхронизировались с семьёй</span><span>›</span>
          </button>
        )}
        {needBackup && !needSync && route === 'home' && (
          <button className="banner warn" onClick={() => go('settings')}>
            <span className="grow">Давно не было резервной копии — сохранить</span><span>›</span>
          </button>
        )}
        {route === 'home' && <Home go={go} />}
        {route === 'cfo' && <Cfo />}
        {route === 'tx' && <Transactions />}
        {route === 'more' && <More go={go} />}
        {route === 'budget' && <Budget />}
        {route === 'goals' && <Goals />}
        {route === 'family' && <Family />}
        {route === 'sync' && <Sync />}
        {route === 'settings' && <Settings />}
      </main>

      <nav className="tabbar" aria-label="Разделы">
        <button className={`tab ${route === 'home' ? 'on' : ''}`} onClick={() => go('home')}>{Icons.home}Главная</button>
        <button className={`tab ${route === 'cfo' ? 'on' : ''}`} onClick={() => go('cfo')}>{Icons.cfo}CFO</button>
        <button className="tab-add" aria-label="Добавить операцию" onClick={() => setAdding(true)}>{Icons.plus}</button>
        <button className={`tab ${route === 'tx' ? 'on' : ''}`} onClick={() => go('tx')}>{Icons.list}Операции</button>
        <button className={`tab ${MORE.includes(route) ? 'on' : ''}`} onClick={() => go('more')}>{Icons.more}Ещё</button>
      </nav>

      {adding && <TransactionSheet onClose={() => setAdding(false)} />}
    </>
  )
}
