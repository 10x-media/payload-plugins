import type { TrackerWindow } from './types'

export interface PageTracking {
	destroy(): void
}

/**
 * Turns SPA navigations into page changes. `history.pushState`/`replaceState` fire no event
 * of their own, so both are wrapped; `popstate` covers back and forward. Only a changed
 * `location.pathname` counts, so a query or hash rewrite (a filter panel, an anchor link)
 * does not report a second pageview. The originals are restored on destroy, which keeps a
 * hot-reloaded or unmounted app from stacking wrappers.
 */
export const createPageTracking = (win: TrackerWindow, onChange: () => void): PageTracking => {
	const history = win.history
	const pushState = history.pushState
	const replaceState = history.replaceState
	let lastPath = win.location.pathname

	const check = () => {
		const path = win.location.pathname
		if (path === lastPath) {
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
