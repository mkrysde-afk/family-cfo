// Модель данных Family CFO.
// Все суммы хранятся в центах (целые числа), чтобы избежать ошибок округления.
// Даты — строки 'YYYY-MM-DD' в локальном времени.

export type Cents = number
export type ISODate = string
export type Confidence = 'high' | 'medium' | 'low'

export type MemberId = string // любой член семьи; 'family' — общий владелец
export type Scope = 'family' | 'personal'

export interface Member {
  id: MemberId
  name: string
  /** 'family' — общий «владелец» для совместных денег */
  isFamily?: boolean
  /** Цвет члена семьи в интерфейсе */
  color: string
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export type AccountKind = 'bank' | 'cash' | 'savings'

export interface Account {
  id: string
  name: string
  owner: MemberId
  kind: AccountKind
  /**
   * Точка отсчёта баланса: известный остаток на конец дня `date`.
   * Операции ПОСЛЕ этой даты меняют баланс; операции до неё — только история для статистики.
   */
  anchor: { date: ISODate; amount: Cents }
  /** Остаток известен приблизительно / не подтверждён пользователем */
  balanceConfidence?: Confidence
  archived?: boolean
  note?: string
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export type TxType = 'expense' | 'income' | 'transfer'
/**
 * posted  — операция произошла
 * planned — будущая операция (участвует в прогнозе)
 * pending — ожидает списания/зачисления в банке (уже известна, ещё не проведена)
 */
export type TxStatus = 'posted' | 'planned' | 'pending'

export interface Transaction {
  id: string
  type: TxType
  status: TxStatus
  date: ISODate
  amount: Cents // всегда > 0; направление задаёт type
  description: string
  /** expense/income */
  categoryId?: string
  accountId?: string
  /** transfer */
  fromAccountId?: string
  toAccountId?: string
  owner: MemberId
  scope: Scope
  note?: string
  /** Связь с регулярным платежом: какой платёж и за какую дату */
  recurringId?: string
  occurrence?: ISODate
  /** Платёж по долгу */
  debtId?: string
  /** Крупная разовая операция — не должна искажать «обычный» уровень */
  irregular?: boolean
  origin?: 'statement' | 'manual' | 'recurring'
  confidence?: Confidence
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export type CategoryKind = 'expense' | 'income'

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  /** Обязательный расход (жильё, связь…) — не discretionary */
  essential?: boolean
  /** Scope по умолчанию при выборе категории */
  defaultScope?: Scope
  /**
   * Участие в плане трат (конвертах):
   * need — необходимое (продукты, бензин, аптека): получает реалистичный минимум;
   * want — желания (кафе, покупки, хобби): получает остаток после накоплений и необходимого.
   * Без флага — фиксированные платежи или разовые траты, в конверты не входят.
   */
  envelope?: 'need' | 'want'
  /** История этой категории учитывается в базе другой категории (например, переводы на покупки → продукты) */
  mergeInto?: string
  color: string
  archived?: boolean
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export type Frequency = 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

export interface Recurring {
  id: string
  name: string
  /** transfer — регулярный перевод между своими счетами (например, в накопления) */
  type: 'expense' | 'income' | 'transfer'
  amount: Cents
  /** для transfer не используется */
  categoryId: string
  /** для transfer — счёт списания */
  accountId: string
  toAccountId?: string
  owner: MemberId
  scope: Scope
  frequency: Frequency
  /** Первая дата платежа; следующие — с шагом frequency, день месяца берётся отсюда */
  startDate: ISODate
  endDate?: ISODate
  active: boolean
  /** Подписка (Netflix, Apple…) */
  subscription?: boolean
  confidence: Confidence
  note?: string
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export interface Goal {
  id: string
  name: string
  target: Cents
  current: Cents
  targetDate?: ISODate
  /**
   * Деньги цели лежат на обычном счёте и должны вычитаться из «Можно потратить».
   * Если false — деньги уже на отдельном (сберегательном) счёте.
   */
  reserve: boolean
  /** Цель — финансовая подушка */
  emergency?: boolean
  /** Цель копит на платёж по долгу: в месяц платежа резерв не вычитается повторно */
  debtId?: string
  /** История пополнений (для «отложено в этом месяце») */
  contributions?: { id?: string; date: ISODate; amount: Cents }[]
  note?: string
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

/** Удержание из зарплаты: считается выплаченным автоматически в свою дату */
export interface DebtDeduction {
  date: ISODate
  amount: Cents
}

export interface Debt {
  id: string
  name: string
  lender: string
  principal: Cents | null
  /** Сколько всего нужно вернуть (null — неизвестно) */
  totalToRepay: Cents | null
  interestRate: number | null
  /** Удержания из зарплаты. Отдельные платежи — это операции с debtId (в т.ч. planned). */
  deductions: DebtDeduction[]
  confidence: Confidence
  note?: string
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export interface MerchantRule {
  id: string
  /** Ключевое слово в нижнем регистре, ищется в описании операции */
  keyword: string
  categoryId: string
  scope?: Scope
  source: 'seed' | 'user'
  hits: number
  /** Время последнего изменения (ISO) — для синхронизации между телефонами */
  updatedAt?: string
}

export interface Coverage {
  from: ISODate
  to: ISODate
  label: string
}

export interface Settings {
  /** pink — светлая розовая тема (например, для второго члена семьи) */
  theme: 'system' | 'light' | 'dark' | 'pink'
  currency: 'EUR'
  /** Сколько откладывать в подушку в месяц; 0 — приложение считает само */
  savingsTarget: Cents
  /** Ручные лимиты конвертов по категориям (перекрывают расчёт) */
  envelopeOverrides?: Record<string, Cents>
  /** Устарело: розовый стал темой. Оставлено для чтения старых копий. */
  accent?: 'blue' | 'pink'
  /** Периоды, за которые история операций полная (выписки) */
  coverage: Coverage[]
  /** С этой даты операции вводятся вручную */
  trackingStart: ISODate
  lastBackupAt?: string
  /** Чей это телефон: член семьи по умолчанию для новых операций (не синхронизируется) */
  me?: MemberId
  /** Когда последний раз синхронизировались с общим файлом (не синхронизируется) */
  lastSyncAt?: string
  /** Когда меняли общие настройки (подушка, конверты) — для синхронизации */
  updatedAt?: string
}

export interface SkippedOccurrence {
  recurringId: string
  occurrence: ISODate
}

export interface AppData {
  version: 1
  members: Member[]
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  recurring: Recurring[]
  skipped: SkippedOccurrence[]
  goals: Goal[]
  debts: Debt[]
  rules: MerchantRule[]
  settings: Settings
  /** Удалённые записи — чтобы удаление дошло до второго телефона при синхронизации */
  deleted?: { id: string; at: string }[]
  /** Ежедневные снимки «Можно потратить» для блока «Что изменилось» */
  snapshots?: { date: ISODate; available: Cents }[]
  meta?: { createdAt: string; source: string; notes?: string[] }
}
