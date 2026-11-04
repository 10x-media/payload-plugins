import type { CollectionBeforeOperationHook, Where } from 'payload'

const CANCELLED_PATH = 'error.cancelled'
const BOOLEAN_OPERATORS = new Set(['equals', 'not_equals'])

const asBoolean = (value: unknown): unknown =>
	value === 'true' ? true : value === 'false' ? false : value

/**
 * Turn `'true'`/`'false'` into booleans on `error.cancelled` throughout a `where`.
 * A where read from a URL carries strings, and the adapters cast them only for
 * checkbox fields, never inside a JSON field.
 */
export const castCancelledWhere = (where: Where): Where => {
	const out: Where = {}
	for (const [key, value] of Object.entries(where)) {
		if ((key === 'and' || key === 'or') && Array.isArray(value)) {
			out[key] = value.map((nested) => castCancelledWhere(nested as Where))
		} else if (key === CANCELLED_PATH && value && typeof value === 'object') {
			out[key] = Object.fromEntries(
				Object.entries(value).map(([operator, operand]) => [
					operator,
					BOOLEAN_OPERATORS.has(operator) ? asBoolean(operand) : operand,
				])
			)
		} else {
			out[key] = value
		}
	}
	return out
}

/**
 * Lets a status filter in the list URL (the health bar's links, or Filters)
 * match on `error.cancelled`, which tells a cancelled job from a failed one.
 */
export const castCancelledQuery: CollectionBeforeOperationHook = ({ args }) => {
	const where = (args as { where?: Where }).where
	if (!where) {
		return args
	}
	return { ...args, where: castCancelledWhere(where) }
}
