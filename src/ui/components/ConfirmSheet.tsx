import { useState } from 'react'
import { eur, formatDate, parseAmount, type Cents } from '../../engine'
import { Sheet } from './common'

/**
 * Подтверждение регулярного платежа или поступления с фактической суммой:
 * ожидалось 40 €, списали 39 или 41 — вписываем, сколько было на самом деле.
 */
export function ConfirmSheet({ label, date, expected, income, onConfirm, onClose }: {
  label: string
  date: string
  expected: Cents
  income?: boolean
  onConfirm: (amount: Cents) => void
  onClose: () => void
}) {
  const [text, setText] = useState((expected / 100).toFixed(2).replace('.', ','))
  const amount = parseAmount(text)
  const diff = amount !== null ? amount - expected : 0

  function done() {
    if (!amount) return
    onConfirm(amount)
    onClose()
  }

  return (
    <Sheet title={income ? 'Поступление пришло' : 'Платёж списался'} onClose={onClose} onDone={done} doneDisabled={!amount} doneLabel="Подтвердить">
      <div className="center" style={{ marginBottom: 4 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="small muted">{formatDate(date, true)} · ожидалось {eur(expected, { cents: true })}</div>
      </div>
      <input
        className="amount-input num"
        inputMode="decimal"
        aria-label="Фактическая сумма"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ''))}
        style={{ color: income ? 'var(--good)' : undefined }}
        autoFocus
      />
      <p className="small center" style={{ margin: '0 0 14px', color: diff === 0 ? 'var(--text-2)' : 'var(--warn)' }}>
        {!amount
          ? 'Введите сумму'
          : diff === 0
            ? 'Сумма как ожидалось'
            : `${diff > 0 ? 'Больше' : 'Меньше'} ожидаемого на ${eur(Math.abs(diff), { cents: true })}`}
      </p>
      <button className="btn primary block" onClick={done} disabled={!amount}>Подтвердить {amount ? eur(amount, { cents: true }) : ''}</button>
    </Sheet>
  )
}
