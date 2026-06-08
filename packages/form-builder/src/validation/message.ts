/** Replace `{key}` placeholders with `String(vars[key])`; unknown placeholders are left as-is. */
export const resolveMessage = (template: string, vars: Record<string, unknown>): string =>
	template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))

/**
 * Race a (possibly async) rule against a deadline so a hung server rule cannot stall the submit path.
 * On timeout the `fallback` is resolved (the engine treats a timed-out rule as a non-blocking skip).
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
	Promise.race([
		promise,
		new Promise<T>((resolve) => {
			setTimeout(() => resolve(fallback), ms)
		}),
	])
