/** Where in the admin a recording was made, parsed from the URL so the team can open the same view. */
export type AdminLocation =
	| { kind: 'collection'; collection: string; docId?: string }
	| { kind: 'global'; global: string }
	| { kind: 'other' }

/**
 * Everything the browser can say about the moment of recording without asking. Sent with the clip
 * so a bug report arrives with the page, the document and the environment it happened in.
 */
export type PageContext = {
	pageUrl: string
	pageTitle: string
	adminRoute: string
	location: AdminLocation
	userAgent: string
	language: string
	timezone: string
	viewport: { width: number; height: number }
	screen: { width: number; height: number; pixelRatio: number }
}

const segmentsAfter = (pathname: string, adminRoute: string): string[] => {
	const base = adminRoute.replace(/\/+$/, '')
	const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : ''
	return rest
		.split('/')
		.filter(Boolean)
		.map((segment) => decodeURIComponent(segment))
}

/**
 * Reads `/admin/collections/<slug>/<id>` and `/admin/globals/<slug>` the way Payload routes them.
 * `create` is the new-document view, not an id.
 */
export const parseAdminLocation = ({
	pathname,
	adminRoute,
}: {
	pathname: string
	adminRoute: string
}): AdminLocation => {
	const [section, slug, id] = segmentsAfter(pathname, adminRoute)
	if (section === 'collections' && slug) {
		return id && id !== 'create'
			? { kind: 'collection', collection: slug, docId: id }
			: { kind: 'collection', collection: slug }
	}
	if (section === 'globals' && slug) {
		return { kind: 'global', global: slug }
	}
	return { kind: 'other' }
}

const resolvedTimezone = (): string => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone
	} catch {
		return ''
	}
}

export const collectPageContext = (adminRoute: string): PageContext => ({
	pageUrl: window.location.href,
	pageTitle: document.title,
	adminRoute,
	location: parseAdminLocation({ pathname: window.location.pathname, adminRoute }),
	userAgent: navigator.userAgent,
	language: navigator.language,
	timezone: resolvedTimezone(),
	viewport: { width: window.innerWidth, height: window.innerHeight },
	screen: {
		width: window.screen.width,
		height: window.screen.height,
		pixelRatio: window.devicePixelRatio,
	},
})
