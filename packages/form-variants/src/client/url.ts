/**
 * Writes one query parameter with the History API rather than the router, so the page is
 * not refetched and unsaved values survive. Next reflects `replaceState` into
 * `useSearchParams`. A `null` value removes the parameter.
 */
export const replaceParam = (name: string, value: null | string): void => {
	if (typeof window === 'undefined') {
		return
	}
	const url = new URL(window.location.href)
	if (value === null) {
		url.searchParams.delete(name)
	} else {
		url.searchParams.set(name, value)
	}
	window.history.replaceState(window.history.state, '', url.toString())
}
