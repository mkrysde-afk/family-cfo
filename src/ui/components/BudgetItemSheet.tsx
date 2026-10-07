import { useState } from 'react'
import { budgetItems, eur, formatDate, parseAmount, type CycleEnvelope, type Transaction } from '../../engine'
import { useData, useStore } from '../../state/store'
import { Sheet, useToast } from './common'

/** Добавить / изменить статью бюджета на период (продукты, бензин…) */
export function BudgetItemSheet({ edit, onClose, onOpenTx }: { edit?: CycleEnvelope; onClose: () => void; onOpenTx?: (t: Transaction) => void }) {
  const data = useData()
  const { updateSettings, limited } = useStore()
  const toast = useToast()
  const items = budgetItems(data)
  const used = new Set(items.map((i) => i.categoryId))
  const options = data.categories.filter((c) => c.kind === 'expense' && !c.archived && (!used.has(c.id) || c.id === edit?.category.id))
  const [categoryId, setCategoryId] = useState(edit?.category.id ?? options[0]?.id ?? '')
  const [amountText, setAmountText] = useState(edit?.manual ? String(edit.amount / 100) : '')
  const amount = amountText.trim() === '' ? null : parseAmount(amountText)
  const valid = !!categoryId && (amountText.trim() === '' || amount !== null)

  function save() {
    if (!valid) return
    const next = items.filter((i) => i.categoryId !== edit?.category.id && i.categoryId !== categoryId)
    const pos = edit ? items.findIndex((i) => i.categoryId === edit.category.id) : next.length
    next.splice(Math.max(pos, 0), 0, { categoryId, amount })
    updateSettings({ budgetItems: next })
    toast(amount === null ? 'Сумма — как рекомендует CFO' : `Статья: ${eur(amount)} до зарплаты`)
    onClose()
  }

  function remove() {
    if (!edit) return
    updateSettings({ budgetItems: items.filter((i) => i.categoryId !== edit.category.id) })
    toast('Статья убрана')
    onClose()
  }

  return (
    <Sheet title={edit ? edit.category.name : 'Новая статья'} onClose={onClose} onDone={limited ? undefined : save} doneDisabled={!valid}>
      {edit && (
        <>
          <div className="row" style={{ margin: '0 4px 8px' }}>
            <span className="muted">Потрачено {eur(edit.spent, { cents: true })} из {eur(edit.amount)}</span>
            <b className={`num ${edit.left < 0 ? 'bad' : ''}`}>{edit.left < 0 ? `перерасход ${eur(-edit.left)}` : `осталось ${eur(edit.left)}`}</b>
          </div>
          <div className="list">
            {edit.txs.length === 0 && <div className="list-item small muted">В этом периоде трат по статье ещё не было.</div>}
            {edit.txs.map((t) => {
              const m = data.members.find((x) => x.id === t.owner)
              return (
                <button key={t.id} className="list-item" onClick={() => onOpenTx?.(t)}>
                  <div className="grow">
                    <div className="title ellipsis">{t.description || edit.category.name}</div>
                    <div className="sub">{formatDate(t.date)}{m && !m.isFamily ? <> · <span style={{ color: m.color }}>{m.name}</span></> : null}</div>
                  </div>
                  <span className="num">−{eur(t.amount, { cents: true })}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
      {limited && edit ? null : (
      <>
      <div className="list">
        {!edit && (
          <div className="field">
            <label htmlFor="bi-cat">Категория</label>
            <select id="bi-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="bi-amount">До зарплаты, €</label>
          <input id="bi-amount" inputMode="decimal" placeholder={edit ? `CFO: ${(edit.suggested / 100).toFixed(0)}` : 'как CFO'} value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))} autoFocus />
        </div>
      </div>
      {edit && (
        <p className="small muted" style={{ margin: '0 4px 12px' }}>
          CFO рекомендует {eur(edit.suggested)} — по вашим обычным тратам в этой категории.
          {edit.suggested > 0 && <> <button className="linklike" onClick={() => setAmountText(String(edit.suggested / 100))}>Взять {eur(edit.suggested)}</button></>}
        </p>
      )}
      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        Сумма сразу откладывается из «Свободно до зарплаты» и уменьшается, когда вы вносите расходы этой категории.
        В день зарплаты статья начинается заново. Пусто — сумма по рекомендации CFO.
      </p>
      <button className="btn primary block" onClick={save} disabled={!valid}>Сохранить</button>
      {edit && <button className="btn danger block" style={{ marginTop: 8 }} onClick={remove}>Убрать статью</button>}
      </>
      )}
    </Sheet>
  )
}
