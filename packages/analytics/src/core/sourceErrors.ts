import type { FilterPair } from './capabilities'
import { isDimensionKey, isFilterOperator } from './guards'

/** `Symbol.for`, so an error thrown in one of the package's bundles is recognized in another. */
const MISCONFIGURED: unique symbol = Symbol.for('@10x-media/analytics/sourceMisconfigured')

const HOST_REFUSED: unique symbol = Symbol.for('@10x-media/analytics/hostRefused')

const UNSUPPORTED_FILTER: unique symbol = Symbol.for('@10x-media/analytics/unsupportedFilter')

const INVALID_QUERY: unique symbol = Symbol.for('@10x-media/analytics/invalidQuery')

/**
 * A source that cannot work as it is set up. Retrying cannot help, only changing its settings
 * can, so reads answer `source_misconfigured` rather than `unavailable` and are never retried.
 */
export class SourceMisconfiguredError extends Error {
	readonly [MISCONFIGURED] = true

	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'SourceMisconfiguredError'
	}
}

/** A host a provider document may not reach: unlisted, private, or not https. */
export class HostRefusedError extends SourceMisconfiguredError {
	readonly [HOST_REFUSED] = true
	readonly host: string

	constructor(host: string, reason: string) {
		super(`analytics: ${host} is refused: ${reason}`)
		this.name = 'HostRefusedError'
		this.host = host
	}
}

/** How deep a cause chain is searched; a cyclic or runaway chain ends here. */
const MAX_CAUSE_DEPTH = 5

/** The first error in `err`'s cause chain carrying `brand`, or undefined. */
const brandedCause = (err: unknown, brand: symbol): object | undefined => {
	let current: unknown = err
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
		if (typeof current !== 'object' || current === null) {
			return undefined
		}
		if (Reflect.get(current, brand) === true) {
			return current
		}
		current = Reflect.get(current, 'cause')
	}
	return undefined
}

/** True for a {@link SourceMisconfiguredError} anywhere in an error's cause chain. */
export const isSourceMisconfigured = (err: unknown): boolean =>
	brandedCause(err, MISCONFIGURED) !== undefined

/** True for a {@link HostRefusedError} anywhere in an error's cause chain. */
export const isHostRefused = (err: unknown): boolean =>
	brandedCause(err, HOST_REFUSED) !== undefined

/**
 * A read carrying a filter its source does not apply. The source would answer without it, and
 * its numbers would read as filtered when they are not, so the read is refused before it is made.
 */
export class UnsupportedFilterError extends Error {
	readonly [UNSUPPORTED_FILTER] = true
	readonly filter: FilterPair

	constructor(source: string, filter: FilterPair) {
		super(`analytics: source "${source}" cannot filter ${filter.dimension} with ${filter.operator}`)
		this.name = 'UnsupportedFilterError'
		this.filter = { dimension: filter.dimension, operator: filter.operator }
	}
}

const isFilterPair = (value: unknown): value is FilterPair =>
	typeof value === 'object' &&
	value !== null &&
	isDimensionKey(Reflect.get(value, 'dimension')) &&
	isFilterOperator(Reflect.get(value, 'operator'))

/**
 * The filter an {@link UnsupportedFilterError} anywhere in an error's cause chain refused, or
 * undefined for any other error.
 */
export const refusedFilter = (err: unknown): FilterPair | undefined => {
	const refusal = brandedCause(err, UNSUPPORTED_FILTER)
	const filter: unknown = refusal === undefined ? undefined : Reflect.get(refusal, 'filter')
	return isFilterPair(filter) ? filter : undefined
}

/**
 * A read its source refuses as asked: a combination it never counts (goal completions broken
 * down by item, say), which no retry or setting changes. Endpoints answer it `invalid_param`.
 */
export class InvalidQueryError extends Error {
	readonly [INVALID_QUERY] = true
	/** The query parameter at fault. */
	readonly param: string

	constructor(message: string, param: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'InvalidQueryError'
		this.param = param
	}
}

/** An error and each cause beneath it, so a log line keeps the driver error a wrapper carries. */
export const describeWithCauses = (err: unknown): string => {
	const parts: string[] = []
	let current: unknown = err
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
		const message = current instanceof Error ? current.message : String(current)
		// A wrapper that already quotes its cause's message (`ReadFailedError`) is not repeated.
		if (!parts.some((part) => message !== '' && part.includes(message))) {
			parts.push(String(current))
		}
		current = typeof current === 'object' ? Reflect.get(current, 'cause') : undefined
	}
	return parts.join(', caused by ')
}

/** The refusal an {@link InvalidQueryError} anywhere in an error's cause chain carries. */
export const invalidQuery = (err: unknown): { message: string; param: string } | undefined => {
	const refusal = brandedCause(err, INVALID_QUERY)
	if (refusal === undefined) {
		return undefined
	}
	const message: unknown = Reflect.get(refusal, 'message')
	const param: unknown = Reflect.get(refusal, 'param')
	return typeof message === 'string' && typeof param === 'string' ? { message, param } : undefined
}
