import { useState } from 'react'
import { parseAmount, type Frequency, type Recurring } from '../../engine'
import { newId, useData, useStore } from '../../state/store'
import { Segmented, Sheet, Switch, useToast } from './common'

/** Создание / редактирование регулярного платежа */
export function RecurringSheet({ edit, onClose }: { edit?: Recurring; onClose: () => void }) {
  const data = useData()
  const { today, saveRecurring, deleteRecurring } = useStore()
  const toast = useToast()
  const accounts = data.accounts.filter((a) => !a.archived)
  const people = data.members.filter((m) => !m.isFamily)

  const [type, setType] = useState<Recurring['type']>(edit?.type ?? 'expense')
  const [name, setName] = useState(edit?.name ?? '')
  const [amountText, setAmountText] = useState(edit ? (edit.amount / 100).toFixed(2).replace('.', ',') : '')
  const [categoryId, setCategoryId] = useState(edit?.categoryId ?? '')
  const [accountId, setAccountId] = useState(edit?.accountId ?? accounts[0]?.id)
  const [toAccountId, setToAccountId] = useState(edit?.toAccountId ?? accounts.find((a) => a.kind === 'savings')?.id ?? accounts[1]?.id)
  const [owner, setOwner] = useState(edit?.owner ?? people[0]?.id ?? 'family')
  const [frequency, setFrequency] = useState<Frequency>(edit?.frequency ?? 'monthly')
  const [startDate, setStartDate] = useState(edit?.startDate ?? today)
  const [endDate, setEndDate] = useState(edit?.endDate ?? '')
  const [active, setActive] = useState(edit?.active ?? true)
  const [subscription, setSubscription] = useState(edit?.subscription ?? false)
  const cats = data.categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense') && !c.archived)
  const amount = parseAmount(amountText)
  const valid = !!name.trim() && !!amount && (type === 'transfer' ? toAccountId !== accountId : !!categoryId)

  function save() {
    if (!valid || !amount) return
    saveRecurring({
      id: edit?.id ?? newId('rec'),
      name: name.trim(),
      type,
      amount,
      categoryId: type === 'transfer' ? 'other' : categoryId,
      accountId: accountId!,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      owner,
      scope: type === 'transfer' ? 'family' : (data.categories.find((c) => c.id === categoryId)?.defaultScope ?? 'family'),
      frequency,
      startDate,
      endDate: endDate || undefined,
      active,
      subscription: type === 'expense' ? subscription : undefined,
      // ручное изменение пользователем = подтверждённые данные
      confidence: 'high',
      note: edit?.note,
    })
    toast('Сохранено')
    onClose()
  }

  return (
    <Sheet title={edit ? 'Регулярный платёж' : 'Новый регулярный'} onClose={onClose} onDone={save} doneDisabled={!valid}>
      <Segmented value={type} options={[['expense', 'Списание'], ['income', 'Поступление'], ['transfer', 'Перевод']]} onChange={(t) => { setType(t); setCategoryId('') }} />
      <div className="list" style={{ marginTop: 12 }}>
        <div className="field"><label htmlFor="rn">Название</label><input id="rn" value={name} placeholder="Аренда" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="ra">Сумма, €</label><input id="ra" inputMode="decimal" value={amountText} placeholder="0,00" onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        {type !== 'transfer' && (
          <div className="field">
            <label htmlFor="rc">Категория</label>
            <select id="rc" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Выбрать…</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="racc">{type === 'income' ? 'Куда' : 'Откуда'}</label>
          <select id="racc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </div>
        {type === 'transfer' && (
          <div className="field">
            <label htmlFor="rto">Куда</label>
            <select id="rto" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
        )}
        <div className="field">
          <label htmlFor="rw">Кто платит</label>
          <select id="rw" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value="family">Семья</option>
          </select>
        </div>
      </div>
      <div className="list">
        <div className="field">
          <label htmlFor="rf">Как часто</label>
          <select id="rf" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="monthly">каждый месяц</option>
            <option value="quarterly">раз в квартал</option>
            <option value="semiannual">раз в полгода</option>
            <option value="yearly">раз в год</option>
          </select>
        </div>
        <div className="field"><label htmlFor="rs">Ближайшая дата</label><input id="rs" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || today)} /></div>
        <div className="field"><label htmlFor="re">До (необяз.)</label><input id="re" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        {type === 'expense' && (
          <div className="field"><label>Подписка</label><span className="grow" /><Switch checked={subscription} onChange={setSubscription} label="Подписка" /></div>
        )}
        <div className="field"><label>Активен</label><span className="grow" /><Switch checked={active} onChange={setActive} label="Активен" /></div>
      </div>
      {edit?.note && <p className="small muted" style={{ margin: '0 4px 12px' }}>{edit.note}</p>}
      <p className="small muted" style={{ margin: '0 4px 12px' }}>В дату платежа он появится в «Ждут подтверждения». До этого сумма уже вычитается из «Можно потратить», если дата в текущем месяце.</p>
      <button className="btn primary block" onClick={save} disabled={!valid}>Сохранить</button>
      {edit && (
        <button className="btn danger block" style={{ marginTop: 8 }} onClick={() => { if (confirm('Удалить регулярный платёж? Уже проведённые операции останутся.')) { deleteRecurring(edit.id); toast('Удалено'); onClose() } }}>
          Удалить
        </button>
      )}
    </Sheet>
  )
}
