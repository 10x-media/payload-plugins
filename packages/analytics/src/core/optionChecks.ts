import { isRecord, kindOf, onlyKeys } from './values'

/**
 * Each key an options object takes, written against its type: a key the type has and the list
 * lacks, or the other way round, is a type error, so the boot's unknown-key check cannot drift.
 */
type KeyList<T> = Readonly<Record<keyof Required<T>, true>>

/** The keys of a {@link KeyList}, as `optionsObject` and `onlyKeys` take them. */
export const keysOf = <T>(keys: KeyList<T>): readonly string[] => Object.keys(keys)

/**
 * An options object at `path`, its keys checked against `known`; anything else, an array included,
 * is refused, saying it must be `example`.
 */
export const optionsObject = (
	value: unknown,
	at: { path: string; known: readonly string[]; example: string }
): Record<string, unknown> => {
	if (!isRecord(value) || Array.isArray(value)) {
		throw new Error(`analytics: ${at.path} must be ${at.example}, got ${kindOf(value)}`)
	}
	onlyKeys(value, at.known, at.path)
	return value
}

/** A boolean option, refused when it is set to anything else. */
export const optionalBoolean = (value: unknown, path: string): boolean | undefined => {
	if (value === undefined || typeof value === 'boolean') {
		return value
	}
	throw new Error(`analytics: ${path} must be true or false, got ${kindOf(value)}`)
}

/** A function option, refused when it is set to anything else. */
export const optionalFunction = <T>(value: T | undefined, path: string): T | undefined => {
	if (value !== undefined && typeof value !== 'function') {
		throw new Error(`analytics: ${path} must be a function, got ${kindOf(value)}`)
	}
	return value
}

/** A list option, empty when unset; anything else is refused, citing `example`. */
export const optionalList = (value: unknown, path: string, example: string): readonly unknown[] => {
	if (value === undefined) {
		return []
	}
	if (!Array.isArray(value)) {
		throw new Error(`analytics: ${path} must be a list such as ${example}, got ${kindOf(value)}`)
	}
	return value
}

/** A count option: a whole number of 1 or more, or `fallback` when unset. */
export const positiveWhole = (value: unknown, path: string, fallback: number): number => {
	if (value === undefined) {
		return fallback
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(
			`analytics: ${path} must be a whole number of 1 or more, got ${typeof value === 'number' ? String(value) : kindOf(value)}`
		)
	}
	return value
}

/** A duration option in whole seconds, 0 or more; undefined when unset. */
export const optionalSeconds = (value: unknown, path: string): number | undefined => {
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(
			`analytics: ${path} must be a whole number of seconds, 0 or more, got ${typeof value === 'number' ? String(value) : kindOf(value)}`
		)
	}
	return value
}

/** A field the plugin reads or stamps as one flat key of a document; `reason` says why no dots. */
export const flatFieldName = (name: unknown, at: { path: string; reason: string }): string => {
	if (typeof name !== 'string' || name.trim() === '') {
		throw new Error(`analytics: ${at.path} must be a non-empty field name`)
	}
	if (name.includes('.')) {
		throw new Error(`analytics: ${at.path} must be a top-level field name (no dots); ${at.reason}`)
	}
	return name
}
