import type { Operator, Where } from 'payload'
import { transformWhereQuery } from 'payload/shared'

const isNil = (value: unknown): boolean => value === null || value === undefined

const toNumber = (value: unknown): number | undefined => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const next = Number(value)
		return Number.isNaN(next) ? undefined : next
	}
	return undefined
}

const toTime = (value: unknown): number | undefined => {
	if (value instanceof Date) {
		return value.getTime()
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const time = Date.parse(value)
		return Number.isNaN(time) ? undefined : time
	}
	return undefined
}

/** Strict, then numeric, then string equality, mirroring Payload's coerce-by-type-then-compare. */
const valuesEqual = (answer: unknown, value: unknown): boolean => {
	if (answer === value) {
		return true
	}
	if (isNil(answer) || isNil(value)) {
		return false
	}
	const a = toNumber(answer)
	const b = toNumber(value)
	if (a !== undefined && b !== undefined) {
		return a === b
	}
	return String(answer) === String(value)
}

const toList = (value: unknown): unknown[] => {
	if (Array.isArray(value)) {
		return value
	}
	if (typeof value === 'string') {
		return value.split(',').map((entry) => entry.trim())
	}
	return [value]
}

const ordered = (
	answer: unknown,
	value: unknown,
	compare: (a: number, b: number) => boolean
): boolean => {
	const a = toNumber(answer) ?? toTime(answer)
	const b = toNumber(value) ?? toTime(value)
	if (a === undefined || b === undefined) {
		return false
	}
	return compare(a, b)
}

/** Case-insensitive: every space-separated word in `value` is a substring of `answer` (Payload `like`). */
const everyWord = (answer: unknown, value: unknown): boolean => {
	const haystack = String(answer).toLowerCase()
	return String(value)
		.toLowerCase()
		.split(' ')
		.filter((word) => word.length > 0)
		.every((word) => haystack.includes(word))
}

const evaluateOperator = (operator: Operator, answer: unknown, value: unknown): boolean => {
	switch (operator) {
		case 'equals':
			return isNil(value) ? isNil(answer) : valuesEqual(answer, value)
		case 'not_equals':
			return isNil(value) ? !isNil(answer) : isNil(answer) || !valuesEqual(answer, value)
		case 'in':
			return toList(value).some((entry) => valuesEqual(answer, entry))
		case 'not_in':
			return isNil(answer) || !toList(value).some((entry) => valuesEqual(answer, entry))
		case 'exists': {
			const present = !isNil(answer) && answer !== ''
			return value === true || value === 'true' ? present : !present
		}
		case 'greater_than':
			return ordered(answer, value, (a, b) => a > b)
		case 'greater_than_equal':
			return ordered(answer, value, (a, b) => a >= b)
		case 'less_than':
			return ordered(answer, value, (a, b) => a < b)
		case 'less_than_equal':
			return ordered(answer, value, (a, b) => a <= b)
		case 'like':
			return isNil(answer) ? false : everyWord(answer, value)
		case 'not_like':
			return isNil(answer) ? true : !everyWord(answer, value)
		case 'contains':
			return isNil(answer)
				? false
				: String(answer).toLowerCase().includes(String(value).toLowerCase())
		default:
			return false
	}
}

/**
 * Evaluate one `Where` node: every top-level key is ANDed. `or` is a disjunction of sub-conditions
 * (an empty `or` matches), `and` is a conjunction, and any other key is a field path whose
 * `{ operator: value }` constraints are ANDed. Recurses, so nested `or`/`and` groups are supported.
 */
const evaluateWhere = (where: Where, answers: Record<string, unknown>): boolean =>
	Object.entries(where).every(([key, constraint]) => {
		if (key === 'or') {
			const groups = (Array.isArray(constraint) ? constraint : []) as Where[]
			return groups.length === 0 || groups.some((group) => evaluateWhere(group, answers))
		}
		if (key === 'and') {
			const groups = (Array.isArray(constraint) ? constraint : []) as Where[]
			return groups.every((group) => evaluateWhere(group, answers))
		}
		if (constraint == null || typeof constraint !== 'object' || Array.isArray(constraint)) {
			return false
		}
		return Object.entries(constraint as Record<string, unknown>).every(([operator, value]) =>
			evaluateOperator(operator as Operator, answers[key], value)
		)
	})

/**
 * Evaluate a serializable `Where`-shaped condition against a flat map of (already coerced) form answers.
 * An absent or empty condition matches (returns true). Operator semantics mirror Payload's query
 * adapters: coerce then compare; `not_equals`/`not_in` are null-inclusive; `exists` treats `''`/absent
 * as not-existing; `like` is case-insensitive and space-splits (every word must be a substring), and
 * `not_like` is its logical negation (at least one word absent); `contains` is a single case-insensitive
 * substring; comma-delimited `in`/`not_in` string values are split and trimmed. Geo (`near`/`within`/
 * `intersects`) and `all` are out of scope and evaluate to false. Isomorphic: no `req`/DB access, so the
 * renderer reuses it client-side.
 */
export const evaluateCondition = (
	where: Where | null | undefined,
	answers: Record<string, unknown>
): boolean => {
	if (!where || Object.keys(where).length === 0) {
		return true
	}
	return evaluateWhere(transformWhereQuery(where), answers)
}
