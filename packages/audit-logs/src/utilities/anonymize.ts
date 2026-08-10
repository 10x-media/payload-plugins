import type { AnonymizeFunction } from '../types'
import { REDACTED } from '../types'

const anonymizeValue = (
  value: unknown,
  path: string,
  collection: string,
  documentId: string,
  operation: 'create' | 'delete' | 'update',
  anonymize: AnonymizeFunction,
): unknown => {
  const result = anonymize({ path, value, collection, documentId, operation, redacted: REDACTED })
  if (result === REDACTED) return REDACTED
  if (result !== value) return result
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item, i) =>
      anonymizeValue(item, `${path}.${i}`, collection, documentId, operation, anonymize),
    )
  }
  if (value !== null && typeof value === 'object') {
    const nested: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      nested[key] = anonymizeValue(child, `${path}.${key}`, collection, documentId, operation, anonymize)
    }
    return nested
  }
  return result
}

/**
 * Recursively anonymizes a document snapshot using full dot-notation paths.
 * For each field, `anonymize` is called with its full path (e.g. `"address.street"`).
 * Return `REDACTED` to omit a value — nested children are skipped entirely.
 */
export const anonymizeDoc = (
  doc: Record<string, unknown>,
  collection: string,
  documentId: string,
  operation: 'create' | 'delete' | 'update',
  anonymize: AnonymizeFunction,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    result[key] = anonymizeValue(value, key, collection, documentId, operation, anonymize)
  }
  return result
}
