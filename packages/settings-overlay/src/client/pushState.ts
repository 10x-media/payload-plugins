/**
 * The part of TanStack Router this needs: the browser history it wraps, and the flag that history
 * reads before telling the router about a change.
 */
type TanStackGlobal = {
	__TSR_ROUTER__?: { history?: { _ignoreSubscribers?: boolean } }
}

/**
 * WORKAROUND. Adds a history entry without the framework loading the route again.
 *
 * Payload's router adapter has `replaceState` for this and no push counterpart. Next does not
 * observe the History API beyond keeping its own state in step, so a plain `pushState` is enough
 * there. TanStack Router monkeypatches `window.history.pushState` and reloads the route on every
 * call, which on the admin is a server round trip that unmounts the page and the panel with it.
 *
 * The TanStack adapter's `replaceState` avoids that by raising the history's `_ignoreSubscribers`
 * around the call, and this does the same for a push. The router publishes itself as
 * `self.__TSR_ROUTER__` on the client; without it, this is a plain `pushState`.
 */
export const pushStateWithoutLoad = (url: string): void => {
	const history = (window as TanStackGlobal).__TSR_ROUTER__?.history
	if (!history) {
		window.history.pushState(null, '', url)
		return
	}
	history._ignoreSubscribers = true
	try {
		window.history.pushState(null, '', url)
	} finally {
		history._ignoreSubscribers = false
	}
}
