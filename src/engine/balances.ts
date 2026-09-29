import type { Account, AppData, Cents, ISODate, Transaction } from './types'

/** Изменение баланса конкретного счёта от одной операции */
export function effectOn(tx: Transaction, accountId: string): Cents {
  switch (tx.type) {
    case 'expense':
      return tx.accountId === accountId ? -tx.amount : 0
    case 'income':
      return tx.accountId === accountId ? tx.amount : 0
    case 'transfer': {
      let e = 0
      if (tx.fromAccountId === accountId) e -= tx.amount
      if (tx.toAccountId === accountId) e += tx.amount
      return e
    }
  }
}

/**
 * Баланс счёта на конец дня asOf.
 * Учитываются только проведённые (posted) операции после даты якоря.
 */
export function accountBalance(account: Account, txs: Transaction[], asOf: ISODate): Cents {
  let b = account.anchor.amount
  for (const tx of txs) {
    if (tx.status !== 'posted') continue
    if (tx.date <= account.anchor.date || tx.date > asOf) continue
    b += effectOn(tx, account.id)
  }
  return b
}

export interface BalanceRow {
  account: Account
  balance: Cents
}

export function balances(data: AppData, asOf: ISODate): BalanceRow[] {
  return data.accounts
    .filter((a) => !a.archived)
    .map((account) => ({ account, balance: accountBalance(account, data.transactions, asOf) }))
}

/** Все деньги семьи (включая накопления) */
export function totalMoney(data: AppData, asOf: ISODate): Cents {
  return balances(data, asOf).reduce((s, r) => s + r.balance, 0)
}

/** Деньги на повседневных счетах (банк + наличные), без накоплений */
export function spendableMoney(data: AppData, asOf: ISODate): Cents {
  return balances(data, asOf)
    .filter((r) => r.account.kind !== 'savings')
    .reduce((s, r) => s + r.balance, 0)
}

export function savingsMoney(data: AppData, asOf: ISODate): Cents {
  return balances(data, asOf)
    .filter((r) => r.account.kind === 'savings')
    .reduce((s, r) => s + r.balance, 0)
}
