/**
 * The current URL with one query parameter set, or removed for `null`. The caller writes it
 * through the router adapter's `replaceState`, which updates the address without refetching the
 * page, so unsaved values survive.
 */
export const withParam = (name: string, value: null | string): null | string => {
	if (typeof window === 'undefined') {
		return null
	}
	const url = new URL(window.location.href)
	if (value === null) {
		url.searchParams.delete(name)
	} else {
		url.searchParams.set(name, value)
	}
	return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Writes one query parameter without a navigation. TanStack Start reloads the route on a plain
 * `history.replaceState` and would remount the form, so the router adapter's own `replaceState`
 * goes first; the History API is the fallback for an adapter that has none.
 */
export const replaceParam = (
	router: { replaceState?: (url: string) => void },
	name: string,
	value: null | string
): void => {
	const url = withParam(name, value)
	if (url === null) {
		return
	}
	if (router.replaceState) {
		router.replaceState(url)
	} else {
		window.history.replaceState(window.history.state, '', url)
	}
}
