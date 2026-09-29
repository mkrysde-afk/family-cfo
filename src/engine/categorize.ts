import type { AppData, Confidence, MerchantRule, Scope } from './types'

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

export interface Suggestion {
  categoryId: string
  scope?: Scope
  rule: MerchantRule
  confidence: Confidence
}

/**
 * Подбирает категорию по описанию операции.
 * Приоритет: правила пользователя → более длинное совпадение → больше срабатываний.
 * Интерфейс намеренно простой: позже сюда можно подключить AI-классификатор с тем же результатом.
 */
export function suggestCategory(rules: MerchantRule[], description: string): Suggestion | null {
  const text = normalize(description)
  if (!text) return null
  let best: MerchantRule | null = null
  for (const r of rules) {
    if (!r.keyword || !text.includes(r.keyword)) continue
    if (!best) {
      best = r
      continue
    }
    const score = (x: MerchantRule) => (x.source === 'user' ? 1e6 : 0) + x.keyword.length * 1000 + x.hits
    if (score(r) > score(best)) best = r
  }
  if (!best) return null
  const confidence: Confidence = best.source === 'user' || best.hits >= 3 ? 'high' : best.keyword.length >= 5 ? 'medium' : 'low'
  return { categoryId: best.categoryId, scope: best.scope, rule: best, confidence }
}

/** Ключ для запоминания: описание целиком, если короткое, иначе первые два слова */
export function ruleKeyword(description: string): string {
  const words = normalize(description).split(' ').filter(Boolean)
  const kw = words.length <= 3 ? words.join(' ') : words.slice(0, 2).join(' ')
  return kw.length >= 3 ? kw : ''
}

/**
 * Запоминает выбор пользователя. Если правило с таким ключом есть — обновляет категорию,
 * иначе создаёт новое пользовательское правило. Возвращает новый массив правил.
 */
export function learnRule(data: AppData, description: string, categoryId: string, scope: Scope, newId: () => string): MerchantRule[] {
  const keyword = ruleKeyword(description)
  if (!keyword) return data.rules
  const existing = data.rules.find((r) => r.keyword === keyword)
  if (existing) {
    return data.rules.map((r) =>
      r === existing ? { ...r, categoryId, scope, source: 'user' as const, hits: r.categoryId === categoryId ? r.hits + 1 : 1 } : r,
    )
  }
  const suggested = suggestCategory(data.rules, description)
  if (suggested && suggested.categoryId === categoryId) {
    // подсказка была верной — просто повышаем уверенность
    return data.rules.map((r) => (r === suggested.rule ? { ...r, hits: r.hits + 1 } : r))
  }
  return [...data.rules, { id: newId(), keyword, categoryId, scope, source: 'user', hits: 1 }]
}
