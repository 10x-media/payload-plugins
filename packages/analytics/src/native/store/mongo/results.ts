import { isRecord } from '../../../core/values'

/** How many documents a `deleteMany` result says it deleted, 0 when it says nothing. */
export const deletedOf = (result: unknown): number => {
	const deleted = isRecord(result) ? result.deletedCount : undefined
	return typeof deleted === 'number' ? deleted : 0
}

/** How many documents an `updateMany` result says it changed, 0 when it says nothing. */
export const modifiedOf = (result: unknown): number => {
	const modified = isRecord(result) ? result.modifiedCount : undefined
	return typeof modified === 'number' ? modified : 0
}

/** The documents a `find` answered, anything but an object skipped. */
export const foundDocuments = (found: unknown): Array<Record<string, unknown>> =>
	Array.isArray(found) ? found.filter(isRecord) : []

/** The strings a `distinct` answered, anything else skipped. */
export const distinctStrings = (values: unknown): string[] =>
	(Array.isArray(values) ? values : []).filter(
		(value): value is string => typeof value === 'string'
	)
