import { isRecord } from '../core/values'

/** Keeps work running past the response that started it, as Next's `after(promise)` does. */
type KeepAlive = (work: Promise<unknown>) => void

const isKeepAlive = (value: unknown): value is KeepAlive => typeof value === 'function'

/** `after` off a module namespace, or off its default export where a bundler only hands that over. */
const afterOf = (mod: unknown): KeepAlive | undefined => {
	if (!isRecord(mod)) {
		return undefined
	}
	const named = mod.after
	if (isKeepAlive(named)) {
		return named
	}
	const inner = isRecord(mod.default) ? mod.default.after : undefined
	return isKeepAlive(inner) ? inner : undefined
}

/**
 * Next's `after()`, or undefined before 15.1. A literal specifier, so the bundler resolves the
 * `next/server` copy serving the request; Node alone cannot, as Next ships no `exports` map.
 */
export const loadNextAfter = async (): Promise<KeepAlive | undefined> => {
	try {
		return afterOf(await import('next/server'))
	} catch {
		return undefined
	}
}

export const NO_AFTER_WARNING =
	"analytics: Next's after() could not be loaded (it needs Next 15.1 or later), so a cached read refreshed in the background may stop once its response is sent on a serverless platform"

interface KeepAliveOptions {
	/** Where `NEXT_RUNTIME` is read: Next sets it in every process that serves its requests. */
	env: Readonly<Record<string, string | undefined>>
	warn: (message: string) => void
	/** Loads `after()`; {@link loadNextAfter} unless a test hands another in. */
	load?: () => Promise<KeepAlive | undefined>
}

/**
 * Hands work to Next's `after()`, loaded once and only in a process Next serves requests in. Warns
 * once where `after()` is missing; outside a request its throw rejects the returned promise.
 */
export const createKeepAlive = (
	options: KeepAliveOptions
): ((work: Promise<unknown>) => Promise<void>) => {
	let loading: Promise<KeepAlive | undefined> | undefined
	let warned = false
	return async (work) => {
		if (!options.env.NEXT_RUNTIME) {
			return
		}
		loading ??= (options.load ?? loadNextAfter)()
		const after = await loading
		if (after) {
			after(work)
			return
		}
		if (!warned) {
			warned = true
			options.warn(NO_AFTER_WARNING)
		}
	}
}
