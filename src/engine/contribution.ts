import { isIncome, isSpending } from './stats'
import type { AppData, Cents, ISODate, Member } from './types'

export interface MemberContribution {
  member: Member
  income: Cents
  familyPaid: Cents
  personal: Cents
  /** Доля в оплате общих семейных расходов, 0..1 */
  share: number
}

export interface FamilyContribution {
  members: MemberContribution[]
  totalIncome: Cents
  totalFamily: Cents
  totalPersonal: Cents
  /** доход − все расходы */
  savings: Cents
  /** расходы, записанные на «Семью» без конкретного плательщика */
  unassignedFamily: Cents
}

/**
 * Прозрачная статистика: кто сколько заработал, сколько оплатил общих и личных расходов.
 * Плательщик — владелец операции (owner). Это не рейтинг, а факты.
 */
export function familyContribution(data: AppData, from: ISODate, to: ISODate): FamilyContribution {
  const people = data.members.filter((m) => !m.isFamily)
  const rows = new Map(people.map((m) => [m.id, { member: m, income: 0, familyPaid: 0, personal: 0, share: 0 }]))
  let unassignedFamily = 0
  let totalIncome = 0
  let totalFamily = 0
  let totalPersonal = 0
  for (const tx of data.transactions) {
    if (tx.date < from || tx.date > to) continue
    const row = rows.get(tx.owner)
    if (isIncome(tx)) {
      totalIncome += tx.amount
      if (row) row.income += tx.amount
    } else if (isSpending(tx)) {
      if (tx.scope === 'family') {
        totalFamily += tx.amount
        if (row) row.familyPaid += tx.amount
        else unassignedFamily += tx.amount
      } else {
        totalPersonal += tx.amount
        if (row) row.personal += tx.amount
      }
    }
  }
  const members = [...rows.values()].map((r) => ({ ...r, share: totalFamily > 0 ? r.familyPaid / totalFamily : 0 }))
  return {
    members,
    totalIncome,
    totalFamily,
    totalPersonal,
    savings: totalIncome - totalFamily - totalPersonal,
    unassignedFamily,
  }
}
