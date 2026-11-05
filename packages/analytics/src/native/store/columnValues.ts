/** A number out of a column: node-postgres reads `bigint` and `numeric` as strings. */
export const numberOf = (value: unknown): number | null => {
	if (value === null || value === undefined) {
		return null
	}
	const number = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(number) ? number : null
}

/** A text column, null when absent and any other value as its text: a driver may answer a number. */
export const textOf = (value: unknown): string | null =>
	typeof value === 'string' ? value : value === null || value === undefined ? null : String(value)

/** A text column that must already be a string, null for anything else. */
export const stringOf = (value: unknown): string | null =>
	typeof value === 'string' ? value : null

/** An instant out of a column: a Date from node-postgres and Mongo, ISO text from SQLite. */
export const dateOf = (value: unknown): Date | null => {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : new Date(value.getTime())
	}
	if (typeof value !== 'string' && typeof value !== 'number') {
		return null
	}
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

/** A JSON column's value: parsed by node-postgres and Mongo, handed back as its text by SQLite. */
export const jsonOf = (raw: unknown): unknown => {
	if (typeof raw !== 'string') {
		return raw
	}
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}
