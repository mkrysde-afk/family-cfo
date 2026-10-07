import { addDays } from './dates'
import { accountBalance } from './balances'
import type { Account, AppData, ISODate } from './types'

/** Детерминированный id кошелька наличных человека — одинаковый на всех телефонах (без дублей при синхронизации) */
export const cashIdFor = (memberId: string) => `cash-${memberId}`

/**
 * Личные наличные: у каждого члена семьи свой кошелёк «Наличные <имя>».
 * Общий кошелёк наличных (владелец «Семья») с нулевым остатком уходит в архив;
 * если на нём есть деньги — остаётся как «Наличные (общие)».
 * Идемпотентно: повторный запуск ничего не меняет.
 */
export function splitCashPerPerson(data: AppData, todayISO: ISODate, nowISO: string): AppData {
  if (data.settings.cashSplit) return data
  const people = data.members.filter((m) => !m.isFamily)
  const accounts: Account[] = data.accounts.map((a) => {
    if (a.kind !== 'cash' || a.archived || people.some((p) => p.id === a.owner)) return a
    const bal = accountBalance(a, data.transactions, todayISO)
    return bal === 0 ? { ...a, archived: true, updatedAt: nowISO } : { ...a, name: 'Наличные (общие)', updatedAt: nowISO }
  })
  for (const p of people) {
    const has = accounts.some((a) => a.kind === 'cash' && a.owner === p.id && !a.archived)
    if (!has) {
      accounts.push({
        id: cashIdFor(p.id),
        name: `Наличные (${p.name})`,
        owner: p.id,
        kind: 'cash',
        anchor: { date: addDays(todayISO, -1), amount: 0 },
        balanceConfidence: 'low',
        note: 'Укажите, сколько наличных сейчас на руках.',
        updatedAt: nowISO,
      })
    }
  }
  return { ...data, accounts, settings: { ...data.settings, cashSplit: true, updatedAt: nowISO } }
}
