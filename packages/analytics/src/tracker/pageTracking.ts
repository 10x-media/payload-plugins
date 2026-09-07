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

	history.pushState = wrap(pushState)
	history.replaceState = wrap(replaceState)
	win.addEventListener('popstate', check)

	return {
		destroy() {
			history.pushState = pushState
			history.replaceState = replaceState
			win.removeEventListener('popstate', check)
		},
	}
}
