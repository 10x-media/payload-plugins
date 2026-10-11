import type { TrackerWindow } from './types'

export interface PageTracking {
	destroy(): void
}

/**
 * Turns SPA navigations into page changes: wraps `pushState`/`replaceState` and hears `popstate`.
 * Only a changed pathname counts, so a query or hash rewrite sends no second pageview.
 */
export const createPageTracking = (win: TrackerWindow, onChange: () => void): PageTracking => {
	const history = win.history
	const pushState = history.pushState
	const replaceState = history.replaceState
	let lastPath = win.location.pathname
	/** A wrapper buried under another library's stays in the chain after destroy, so it goes quiet. */
	let active = true

	const check = () => {
		const path = win.location.pathname
		if (!active || path === lastPath) {
			return
		}
		lastPath = path
		onChange()
	}

	const wrap =
		(original: typeof history.pushState) =>
		(...args: Parameters<typeof history.pushState>) => {
			original.apply(history, args)
			check()
		}

	const patchedPush = wrap(pushState)
	const patchedReplace = wrap(replaceState)
	history.pushState = patchedPush
	history.replaceState = patchedReplace
	win.addEventListener('popstate', check)

	return {
		destroy() {
			active = false
			// Only unwind our own wrapper: another library may have patched on top of it,
			// and restoring the original underneath it would silently unhook that library.
			if (history.pushState === patchedPush) {
				history.pushState = pushState
			}
			if (history.replaceState === patchedReplace) {
				history.replaceState = replaceState
			}
			win.removeEventListener('popstate', check)
		},
	}
}
