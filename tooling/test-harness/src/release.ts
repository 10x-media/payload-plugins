import type { Payload } from 'payload'

/** Work an instance finishes before its `payload.destroy()`; see `onRelease`. */
export type ReleaseHook = (payload: Payload) => Promise<void>

/** How long a release waits on the hooks before it destroys the instance anyway. */
const SETTLE_LIMIT_MS = 15_000

const hooks = new Set<ReleaseHook>()

/**
 * Runs `hook` before every boot's `payload.destroy()` in this test file, so a plugin's background
 * work (a write buffer, maintenance, a worker thread mid-statement) settles while the database is
 * still open, rather than being cut off when the worker ends. Kept light so a vitest setup file
 * can register one without loading any database adapter. Answers the function that removes it.
 */
export const onRelease = (hook: ReleaseHook): (() => void) => {
	hooks.add(hook)
	return () => {
		hooks.delete(hook)
	}
}

/** Every registered hook for `payload`, bounded: a hook that never settles delays, not blocks. */
export const settleBeforeRelease = async (payload: Payload): Promise<void> => {
	if (hooks.size === 0) {
		return
	}
	let timer: ReturnType<typeof setTimeout> | undefined
	const limit = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, SETTLE_LIMIT_MS)
	})
	try {
		await Promise.race([Promise.allSettled([...hooks].map(async (hook) => hook(payload))), limit])
	} finally {
		clearTimeout(timer)
	}
}
