/** A non-null object. Arrays pass too, so a caller that refuses them checks `Array.isArray`. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/**
 * Whether `value` carries every one of `names` as a method. Functions pass too, since a driver
 * handle can be a class whose methods are static (a mongoose model).
 */
export const hasMethods = (value: unknown, names: readonly string[]): boolean =>
	(typeof value === 'object' || typeof value === 'function') &&
	value !== null &&
	names.every((name) => typeof Reflect.get(value, name) === 'function')

/** Whether `value` is one of `list`, narrowing it to the list's element type. */
export const isOneOf = <T>(list: readonly T[], value: unknown): value is T =>
	list.some((each) => each === value)

/** How a boot error names a value it refused: a string quoted, an array as one, else its type. */
export const kindOf = (value: unknown): string =>
	typeof value === 'string' ? `"${value}"` : Array.isArray(value) ? 'an array' : typeof value

/** Names as a boot error lists them: `a`, `a and b`, `a, b and c`. */
export const listOf = (names: readonly string[]): string =>
	names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('')

/** The earlier of two ISO instants; either may be absent, and a missing one yields the other. */
export function earlierInstant(a: string | undefined, b: string): string
export function earlierInstant(a: string | undefined, b: string | undefined): string | undefined
export function earlierInstant(a: string | undefined, b: string | undefined): string | undefined {
	if (a === undefined) return b
	if (b === undefined) return a
	return Date.parse(b) < Date.parse(a) ? b : a
}

/** Refuses any key of `value` outside `known`, naming the ones `path` takes. */
export const onlyKeys = (
	value: Record<string, unknown>,
	known: readonly string[],
	path: string
): void => {
	for (const key of Object.keys(value)) {
		if (!known.includes(key)) {
			throw new Error(`analytics: ${path}.${key} is not an option; ${path} takes ${listOf(known)}`)
		}
	}
}

/** The value at a dotted path, or undefined once a step along it is not an object. */
export const valueAt = (target: unknown, path: string): unknown => {
	let current: unknown = target
	for (const key of path.split('.')) {
		if (!isRecord(current)) {
			return undefined
		}
		current = current[key]
	}
	return current
}

const canonicalOf = (value: unknown): unknown => {
	if (value instanceof Date) {
		return value.toISOString()
	}
	if (Array.isArray(value)) {
		return value.map((entry) => (entry === undefined ? null : canonicalOf(entry)))
	}
	if (!isRecord(value)) {
		return value
	}
	const sorted: Record<string, unknown> = {}
	for (const key of Object.keys(value).sort()) {
		const entry = value[key]
		if (entry !== undefined) {
			sorted[key] = canonicalOf(entry)
		}
	}
	return sorted
}

/**
 * JSON two equal values always write alike: keys in code point order, `undefined` keys dropped,
 * Dates as ISO. Array order is kept, so callers sort set-like arrays first.
 */
export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalOf(value)) ?? ''

/**
 * A query parameter read as a whole number, or undefined when it is absent, blank or anything
 * else: `Number(null)` and `Number('')` are 0, which a caller would clamp into a real value.
 */
export const wholeNumberParam = (raw: string | null | undefined): number | undefined => {
	if (raw === null || raw === undefined || !/^-?\d+$/.test(raw.trim())) {
		return undefined
	}
	const value = Number(raw.trim())
	return Number.isSafeInteger(value) ? value : undefined
}
