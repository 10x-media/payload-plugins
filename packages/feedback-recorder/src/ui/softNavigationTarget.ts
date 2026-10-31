/**
 * The slice of the Navigation API's `navigate` event this needs. TypeScript's DOM types do not
 * list the API yet.
 */
export type NavigateEventLike = {
	cancelable: boolean
	navigationType: 'push' | 'replace' | 'reload' | 'traverse'
	hashChange: boolean
	downloadRequest: string | null
	formData: unknown
	destination: { url: string; sameDocument: boolean }
	preventDefault: () => void
}

/**
 * Where to send the router instead, or null to let the browser have it. Only a full page load into
 * the admin qualifies: a plain `<a href>` or `location.assign` that would throw away the page, and
 * with it the recording. Client-side navigations (`sameDocument`), reloads, back and forward,
 * downloads, form posts and anything outside the admin are left alone.
 */
export const softNavigationTarget = (
	event: Omit<NavigateEventLike, 'preventDefault'>,
	{ origin, adminRoute }: { origin: string; adminRoute: string }
): string | null => {
	if (!event.cancelable || event.destination.sameDocument || event.hashChange) return null
	if (event.navigationType !== 'push' && event.navigationType !== 'replace') return null
	if (event.downloadRequest !== null || event.formData) return null

	const url = new URL(event.destination.url)
	if (url.origin !== origin) return null
	const base = `/${adminRoute.replace(/^\/+|\/+$/g, '')}`
	const inAdmin = base === '/' || url.pathname === base || url.pathname.startsWith(`${base}/`)
	return inAdmin ? `${url.pathname}${url.search}${url.hash}` : null
}
