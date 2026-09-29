import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { eur, type AppData, type Cents, type Confidence } from '../../engine'

export function Money({ c, cents, sign, className }: { c: Cents; cents?: boolean; sign?: boolean; className?: string }) {
  return <span className={`num ${className ?? ''}`}>{eur(c, { cents, sign })}</span>
}

const CONF: Record<Confidence, [string, string]> = {
  high: ['Высокая уверенность', 'good'],
  medium: ['Средняя уверенность', 'warn'],
  low: ['Низкая уверенность', 'bad'],
}
export function ConfBadge({ c, short }: { c: Confidence; short?: boolean }) {
  const [label, cls] = CONF[c]
  return <span className={`badge ${cls}`}>{short ? label.split(' ')[0] : label}</span>
}

export function Bar({ value, max, color, marker }: { value: number; max: number; color: string; marker?: number }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="bar">
      <span style={{ width: `${Math.max(w, value > 0 ? 2 : 0)}%`, background: color }} />
      {marker !== undefined && max > 0 && <i className="marker" style={{ left: `${Math.min((marker / max) * 100, 99)}%` }} />}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Sheet({ title, onClose, onDone, doneLabel = 'Готово', doneDisabled, children }: {
  title: string
  onClose: () => void
  onDone?: () => void
  doneLabel?: string
  doneDisabled?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <button onClick={onClose}>Отмена</button>
          <span className="title">{title}</span>
          {onDone ? (
            <button className="strong" onClick={onDone} disabled={doneDisabled} style={{ opacity: doneDisabled ? 0.4 : 1 }}>
              {doneLabel}
            </button>
          ) : (
            <span style={{ width: 60 }} />
          )}
        </div>
        {children}
      </div>
    </>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

/* ---------- Тосты ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {})
export function useToast() {
  return useContext(ToastCtx)
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const show = useCallback((m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2200)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  )
}

/* ---------- Кольцевая диаграмма ---------- */
export function Donut({ parts, size = 132, stroke = 16, center }: { parts: { value: number; color: string }[]; size?: number; stroke?: number; center?: ReactNode }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Структура расходов">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card-2)" strokeWidth={stroke} />
        {total > 0 &&
          parts.map((p, i) => {
            const len = (p.value / total) * C
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )
            offset += len
            return el
          })}
      </svg>
      {center && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', textAlign: 'center' }}>{center}</div>}
    </div>
  )
}

/* ---------- Кольцо индекса ---------- */
export function ScoreRing({ score, size = 76 }: { score: number; size?: number }) {
  const color = score >= 75 ? 'var(--good)' : score >= 55 ? 'var(--accent)' : score >= 35 ? 'var(--warn)' : 'var(--bad)'
  const stroke = 8
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} role="img" aria-label={`Индекс ${score} из 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(score / 100) * C} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22 }}>{score}</div>
    </div>
  )
}

/* ---------- Мини-гистограмма по месяцам ---------- */
export function MonthBars({ items, height = 80 }: { items: { label: string; value: number; color?: string; highlight?: boolean }[]; height?: number }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height + 18 }}>
      {items.map((i, k) => (
        <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ width: '100%', maxWidth: 28, height: Math.max((i.value / max) * height, 2), background: i.color ?? (i.highlight ? 'var(--accent)' : 'var(--text-3)'), borderRadius: 4, opacity: i.highlight ? 1 : 0.55 }} title={eur(i.value)} />
          <span className="tiny muted">{i.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Иконки (контурные, в стиле SF Symbols) ---------- */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
export const Icons = {
  home: <svg viewBox="0 0 24 24" {...P}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>,
  cfo: <svg viewBox="0 0 24 24" {...P}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></svg>,
  list: <svg viewBox="0 0 24 24" {...P}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>,
  more: <svg viewBox="0 0 24 24" {...P}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>,
  plus: <svg viewBox="0 0 24 24" {...P} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>,
  chevron: <svg viewBox="0 0 24 24" {...P} width={16} height={16}><path d="m9 6 6 6-6 6" /></svg>,
  left: <svg viewBox="0 0 24 24" {...P} width={20} height={20}><path d="m15 6-6 6 6 6" /></svg>,
  budget: <svg viewBox="0 0 24 24" {...P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  goals: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>,
  family: <svg viewBox="0 0 24 24" {...P}><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20a5.5 5.5 0 0 1 11 0M13.5 20a4 4 0 0 1 8 0" /></svg>,
  settings: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  repeat: <svg viewBox="0 0 24 24" {...P} width={18} height={18}><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></svg>,
  check: <svg viewBox="0 0 24 24" {...P} width={18} height={18}><path d="M20 6 9 17l-5-5" /></svg>,
}

/* ---------- Справочники ---------- */
export function useLookups(data: AppData) {
  const cat = (id?: string) => data.categories.find((c) => c.id === id)
  const acc = (id?: string) => data.accounts.find((a) => a.id === id)
  const mem = (id?: string) => data.members.find((m) => m.id === id)
  return { cat, acc, mem }
}

export function Initial({ name, color, size = 34 }: { name: string; color: string; size?: number }) {
  return (
    <span className="icon-circle" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
