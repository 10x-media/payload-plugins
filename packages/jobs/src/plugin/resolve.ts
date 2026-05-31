/**
 * A customization point: pass a value to replace our default, or a function to
 * transform it. The function form receives the default so callers can compose
 * (extend, filter, reorder) instead of rewriting from scratch.
 */
export type Override<T> = ((defaults: T) => T) | T

/** Apply an `Override`, falling back to `defaults` when none was provided. */
export const resolve = <T>(override: Override<T> | undefined, defaults: T): T => {
	if (override === undefined) {
		return defaults
	}
	return typeof override === 'function' ? (override as (value: T) => T)(defaults) : override
}
