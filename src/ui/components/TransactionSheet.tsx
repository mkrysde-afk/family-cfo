import { useMemo, useState } from 'react'
import { eur, parseAmount, suggestCategory, type Frequency, type Scope, type Transaction, type TxType } from '../../engine'
import { newId, useData, useStore } from '../../state/store'
import { Segmented, Sheet, Switch, useToast } from './common'

interface Props {
  onClose: () => void
  /** редактирование существующей операции */
  edit?: Transaction
  initialType?: TxType
  /** «Запланировать трату»: сумма сразу вычитается из бюджета, потом отмечается галочкой */
  plan?: boolean
}

const TYPE_LABEL: [TxType, string][] = [
  ['expense', 'Расход'],
  ['income', 'Доход'],
  ['transfer', 'Перевод'],
]

/** Быстрое добавление / редактирование операции */
export function TransactionSheet({ onClose, edit, initialType = 'expense', plan: planProp = false }: Props) {
  const data = useData()
  const { today, addTransaction, updateTransaction, deleteTransaction, saveRecurring, confirmPending, limited } = useStore()
  const plan = planProp || edit?.status === 'planned'
  // в упрощённом режиме чужие операции и записи из выписок только для просмотра
  const readOnly = limited && !!edit && (edit.owner !== data.settings.me || edit.origin === 'statement' || edit.origin === 'recurring')
  const toast = useToast()
  const people = data.members.filter((m) => !m.isFamily)
  const accounts = data.accounts.filter((a) => !a.archived)

  const [type, setType] = useState<TxType>(edit?.type ?? initialType)
  const [amountText, setAmountText] = useState(edit ? (edit.amount / 100).toFixed(2).replace('.', ',') : '')
  const [description, setDescription] = useState(edit?.description ?? '')
  const [categoryId, setCategoryId] = useState<string | undefined>(edit?.categoryId)
  const [categoryTouched, setCategoryTouched] = useState(!!edit)
  const [owner, setOwner] = useState(edit?.owner ?? data.settings.me ?? people[0]?.id ?? 'family')
  const [scope, setScope] = useState<Scope>(edit?.scope ?? 'family')
  const [scopeTouched, setScopeTouched] = useState(!!edit)
  const defaultAccount = (o: string) => accounts.find((a) => a.owner === o && a.kind === 'bank')?.id ?? accounts[0]?.id
  const [accountId, setAccountId] = useState(edit?.accountId ?? defaultAccount(owner))
  const [fromId, setFromId] = useState(edit?.fromAccountId ?? defaultAccount(data.settings.me ?? people[0]?.id ?? 'family'))
  const [toId, setToId] = useState(edit?.toAccountId ?? accounts.find((a) => a.kind === 'cash')?.id ?? accounts[1]?.id)
  const [date, setDate] = useState(edit?.date ?? today)
  const [note, setNote] = useState(edit?.note ?? '')
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [showAllCats, setShowAllCats] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = parseAmount(amountText)
  const kindCats = data.categories.filter((c) => c.kind === (type === 'income' ? 'income' : 'expense') && !c.archived)

  // Подсказка категории по описанию (локальные правила, без внешнего AI)
  const suggestion = useMemo(() => (type === 'transfer' ? null : suggestCategory(data.rules, description)), [data.rules, description, type])
  const effectiveCategory = categoryTouched ? categoryId : suggestion && kindCats.some((c) => c.id === suggestion.categoryId) ? suggestion.categoryId : categoryId
  const effectiveScope: Scope = scopeTouched ? scope : (data.categories.find((c) => c.id === effectiveCategory)?.defaultScope ?? scope)

  // Часто используемые категории — первыми
  const orderedCats = useMemo(() => {
    const use = new Map<string, number>()
    for (const t of data.transactions.slice(-400)) if (t.categoryId) use.set(t.categoryId, (use.get(t.categoryId) ?? 0) + 1)
    return [...kindCats].sort((a, b) => (use.get(b.id) ?? 0) - (use.get(a.id) ?? 0))
  }, [data.transactions, kindCats])
  const visibleCats = [...(showAllCats ? orderedCats : orderedCats.slice(0, 8))]
  if (effectiveCategory && !visibleCats.some((c) => c.id === effectiveCategory)) {
    const c = orderedCats.find((x) => x.id === effectiveCategory)
    if (c) visibleCats.unshift(c)
  }

  const isFuture = date > today
  const canSave = !!amount && (type === 'transfer' ? !!fromId && !!toId && fromId !== toId : !!effectiveCategory && !!accountId)

  function save() {
    setError(null)
    if (!amount) return setError('Введите сумму больше нуля')
    if (type === 'transfer' && fromId === toId) return setError('Счета «откуда» и «куда» должны отличаться')
    if (type !== 'transfer' && !effectiveCategory) return setError('Выберите категорию')

    if (repeat && type !== 'transfer' && !edit) {
      saveRecurring({
        id: newId('rec'),
        name: description.trim() || data.categories.find((c) => c.id === effectiveCategory)?.name || 'Регулярный платёж',
        type,
        amount,
        categoryId: effectiveCategory!,
        // в упрощённом режиме регулярный платёж — всегда свой и со своей карты
        accountId: limited && data.accounts.find((x) => x.id === accountId)?.owner !== data.settings.me ? (data.accounts.find((x) => x.owner === data.settings.me && !x.archived)?.id ?? accountId!) : accountId!,
        owner: limited ? (data.settings.me ?? owner) : owner,
        scope: effectiveScope,
        frequency,
        startDate: date,
        active: true,
        confidence: 'high',
      })
      toast('Регулярный платёж добавлен')
      onClose()
      return
    }

    const base = {
      type,
      status: (plan ? 'planned' : edit?.status === 'pending' ? 'pending' : isFuture ? 'planned' : 'posted') as Transaction['status'],
      date,
      amount,
      description: description.trim() || (type === 'transfer' ? 'Перевод' : data.categories.find((c) => c.id === effectiveCategory)?.name ?? ''),
      owner,
      scope: effectiveScope,
      note: note.trim() || undefined,
      origin: edit?.origin ?? ('manual' as const),
      ...(type === 'transfer' ? { fromAccountId: fromId, toAccountId: toId } : { categoryId: effectiveCategory, accountId }),
    }
    // Запоминаем выбор категории, если пользователь исправил подсказку или её не было
    const learn = type !== 'transfer' && !!description.trim() && (!suggestion || suggestion.categoryId !== effectiveCategory || categoryTouched)
    if (edit) {
      const next: Transaction = { ...edit, ...base }
      if (type === 'transfer') {
        delete next.categoryId
        delete next.accountId
      } else {
        delete next.fromAccountId
        delete next.toAccountId
      }
      updateTransaction(next, learn)
      toast('Сохранено')
    } else {
      addTransaction(base, learn)
      toast(plan ? `Запланировано: ${eur(amount)} вычтено из бюджета` : isFuture ? `Запланировано на ${date.split('-').reverse().join('.')}` : type === 'transfer' ? 'Перевод добавлен' : type === 'income' ? 'Доход добавлен' : 'Расход добавлен')
    }
    onClose()
  }

  return (
    <Sheet title={plan ? (edit ? 'Запланированная трата' : 'Запланировать трату') : edit ? 'Операция' : 'Новая операция'} onClose={onClose} onDone={readOnly ? undefined : save} doneDisabled={!canSave}>
      {readOnly && <div className="banner" style={{ marginBottom: 10 }}>Только просмотр: эту операцию может изменить основной телефон.</div>}
      {!plan && <Segmented value={type} options={TYPE_LABEL} onChange={(t) => { setType(t); setCategoryId(undefined); setCategoryTouched(false) }} />}
      <input
        className="amount-input num"
        inputMode="decimal"
        placeholder="0 €"
        aria-label="Сумма"
        autoFocus={!edit}
        value={amountText}
        onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))}
        style={{ color: type === 'income' ? 'var(--good)' : undefined }}
      />
      {amountText && !amount && <div className="error center">Сумма указана неверно</div>}

      {type !== 'transfer' ? (
        <>
          <div className="list">
            <div className="field">
              <label htmlFor="desc">Описание</label>
              <input id="desc" placeholder={plan ? 'Маникюр' : 'Kaufland'} value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="date">Дата</label>
              <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
            </div>
            <div className="field">
              <label htmlFor="acc">{type === 'income' ? 'Куда' : 'Откуда'}</label>
              <select id="acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="row small muted" style={{ margin: '0 4px 6px' }}>
            <span>
              Категория
              {suggestion && !categoryTouched && effectiveCategory === suggestion.categoryId && <> · подсказка по «{suggestion.rule.keyword}»</>}
            </span>
          </div>
          <div className="chips" style={{ marginBottom: 12 }}>
            {visibleCats.map((c) => {
              const on = c.id === effectiveCategory
              return (
                <button key={c.id} className={`chip ${on ? 'on' : ''}`} style={on ? { background: c.color } : undefined} onClick={() => { setCategoryId(c.id); setCategoryTouched(true) }}>
                  {!on && <span className="dot" style={{ background: c.color }} />}
                  {c.name}
                </button>
              )
            })}
            {orderedCats.length > 8 && (
              <button className="chip" onClick={() => setShowAllCats((v) => !v)}>{showAllCats ? 'Меньше' : 'Ещё…'}</button>
            )}
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <div className="grow">
              <div className="small muted" style={{ margin: '0 4px 6px' }}>Кто платит</div>
              <div className="segmented">
                {people.map((m) => (
                  <button key={m.id} className={owner === m.id ? 'on' : ''} style={owner === m.id ? { color: m.color, fontWeight: 600 } : undefined}
                    onClick={() => { setOwner(m.id); if (!edit) setAccountId(defaultAccount(m.id)) }}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grow">
              <div className="small muted" style={{ margin: '0 4px 6px' }}>Для кого</div>
              <Segmented value={effectiveScope} options={[['family', 'Семья'], ['personal', 'Личное']]} onChange={(s) => { setScope(s); setScopeTouched(true) }} />
            </div>
          </div>
        </>
      ) : (
        <div className="list">
          <div className="field">
            <label htmlFor="from">Откуда</label>
            <select id="from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="to">Куда</label>
            <select id="to" value={toId} onChange={(e) => setToId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tdate">Дата</label>
            <input id="tdate" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
          </div>
          <div className="field">
            <label htmlFor="tnote">Заметка</label>
            <input id="tnote" placeholder="Снял в банкомате" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      )}

      {type !== 'transfer' && (
        <div className="list">
          <div className="field">
            <label htmlFor="note">Заметка</label>
            <input id="note" placeholder="Необязательно" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {!edit && !plan && (
            <div className="field">
              <label>Повторять</label>
              <span className="grow" />
              {repeat && (
                <select aria-label="Периодичность" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} style={{ flex: 'none', marginRight: 8, color: 'var(--accent)' }}>
                  <option value="monthly">каждый месяц</option>
                  <option value="quarterly">раз в квартал</option>
                  <option value="semiannual">раз в полгода</option>
                  <option value="yearly">раз в год</option>
                </select>
              )}
              <Switch checked={repeat} onChange={setRepeat} label="Повторять" />
            </div>
          )}
        </div>
      )}

      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        {plan
          ? 'Сумма сразу вычитается из общего бюджета. Когда потратите — отметьте галочкой на главном экране. В день траты пункт подсветится.'
          : type === 'transfer'
          ? 'Перевод между своими счетами не считается расходом и не меняет общий капитал семьи.'
          : repeat
            ? `Будет добавлен регулярный платёж с ${date.split('-').reverse().join('.')}. В свою дату он попросит подтверждения.`
            : isFuture
              ? 'Дата в будущем — операция будет запланирована и учтена в прогнозе и в «Можно потратить».'
              : amount ? `${type === 'income' ? '+' : '−'}${eur(amount, { cents: true })}` : ''}
      </p>
      {error && <div className="error">{error}</div>}

      {!readOnly && <button className="btn primary block" onClick={save} disabled={!canSave}>{edit ? 'Сохранить' : plan ? 'Запланировать' : 'Добавить'}</button>}
      {!readOnly && edit && edit.status === 'planned' && (
        <button className="btn block" style={{ marginTop: 8 }} onClick={() => { confirmPending(edit.id); toast('Отмечено: потрачено'); onClose() }}>
          Потрачено ✓
        </button>
      )}
      {edit && !readOnly && (
        <button className="btn danger block" style={{ marginTop: 8 }} onClick={() => { if (confirm('Удалить операцию?')) { deleteTransaction(edit.id); toast('Удалено'); onClose() } }}>
          Удалить операцию
        </button>
      )}
    </Sheet>
  )
}
