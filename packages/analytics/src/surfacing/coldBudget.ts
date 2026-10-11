/** Cold reads one scope may have waiting on its sources at once, by default. */
export const DEFAULT_COLD_READS_PER_SCOPE = 8

/** What a refused cold read is told to wait: about one vendor round trip. */
export const BUSY_RETRY_AFTER_MS = 2_000

/**
 * Per-scope places for cold reads (no cached answer, waiting on their source), so one tenant's
 * dozen cold dashboards queue behind its own reads, never in front of every other tenant's.
 */
export interface ColdBudget {
	/** Whether a cold read of `scope` would start at once. */
	available(scope: string | null): boolean
	/** A place for one cold read of `scope`, waiting in arrival order while none is free. */
	take(scope: string | null, signal: AbortSignal): Promise<() => void>
}

interface ScopePlaces {
	active: number
	waiters: Array<() => void>
}

const keyOf = (scope: string | null): string => (scope === null ? '' : `s:${scope}`)

export const createColdBudget = (perScope: number): ColdBudget => {
	const scopes = new Map<string, ScopePlaces>()

	const placesOf = (key: string): ScopePlaces => {
		const existing = scopes.get(key)
		if (existing) {
			return existing
		}
		const created: ScopePlaces = { active: 0, waiters: [] }
		scopes.set(key, created)
		return created
	}

	const releaseFor = (key: string, places: ScopePlaces): (() => void) => {
		let released = false
		return () => {
			if (released) {
				return
			}
			released = true
			places.active--
			const next = places.waiters.shift()
			if (next) {
				next()
			} else if (places.active === 0) {
				scopes.delete(key)
			}
		}
	}

	return {
		available(scope) {
			return (scopes.get(keyOf(scope))?.active ?? 0) < perScope
		},
		take(scope, signal) {
			if (signal.aborted) {
				return Promise.reject(signal.reason)
			}
			const key = keyOf(scope)
			const places = placesOf(key)
			if (places.active < perScope && places.waiters.length === 0) {
				places.active++
				return Promise.resolve(releaseFor(key, places))
			}
			return new Promise<() => void>((resolve, reject) => {
				const grant = (): void => {
					signal.removeEventListener('abort', onAbort)
					places.active++
					resolve(releaseFor(key, places))
				}
				const onAbort = (): void => {
					const index = places.waiters.indexOf(grant)
					if (index !== -1) {
						places.waiters.splice(index, 1)
					}
					reject(signal.reason)
				}
				places.waiters.push(grant)
				signal.addEventListener('abort', onAbort, { once: true })
			})
		},
	}
}
