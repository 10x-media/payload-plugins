import { isRecord } from '../core/values'

/** One site a browser can be left out of, with the token of the scope it belongs to. */
export interface ExclusionSite {
	/** An `http(s)` origin with an optional path, as `capture.exclusion.sites` names it. */
	address: string
	/** The parameter's value that leaves a browser out of this site's numbers. */
	token: string
}

export interface ExclusionResponse {
	/** The query parameter the tracker reads. */
	param: string
	/** The requested scope's own token, for a site whose address the admin cannot know. */
	token: string
	/**
	 * Whether this admin's own address is one of the scope's sites, which the view then links to
	 * when `sites` is empty: `null` on an unscoped install, which cannot tell.
	 */
	sameOrigin: boolean | null
	/**
	 * Sites `capture.exclusion.sites` names for the scope, each with its token; on all sites, every
	 * listed scope's for a reader who may name each. Empty where the install names none.
	 */
	sites: ExclusionSite[]
}

const readSites = (value: unknown): ExclusionSite[] | null => {
	if (!Array.isArray(value)) {
		return null
	}
	const items: unknown[] = value
	const sites: ExclusionSite[] = []
	for (const item of items) {
		if (!isRecord(item) || typeof item.address !== 'string' || typeof item.token !== 'string') {
			return null
		}
		sites.push({ address: item.address, token: item.token })
	}
	return sites
}

/** The exclusion endpoint's answer, or null for a body of any other shape. */
export const readExclusionResponse = (body: unknown): ExclusionResponse | null => {
	if (
		!isRecord(body) ||
		typeof body.param !== 'string' ||
		typeof body.token !== 'string' ||
		!(typeof body.sameOrigin === 'boolean' || body.sameOrigin === null)
	) {
		return null
	}
	const sites = readSites(body.sites)
	return sites ? { param: body.param, token: body.token, sameOrigin: body.sameOrigin, sites } : null
}

/**
 * What the view hands staff to copy where the install names no site: the part to add to the
 * site's own address, which the admin cannot know, a separate frontend's included.
 */
export const exclusionQuery = (link: Pick<ExclusionResponse, 'param' | 'token'>): string =>
	`?${encodeURIComponent(link.param)}=${encodeURIComponent(link.token)}`

/** One site's whole exclusion link: its address with the parameter set, any other query kept. */
export const exclusionUrl = (
	site: string,
	link: Pick<ExclusionResponse, 'param' | 'token'>
): string => {
	const url = new URL(site)
	url.searchParams.set(link.param, link.token)
	return url.toString()
}

/** A site as a reader names it: its host, with the path when it has one beyond `/`. */
export const siteName = (site: string): string => {
	const url = new URL(site)
	return url.pathname === '/' ? url.host : `${url.host}${url.pathname}`
}
