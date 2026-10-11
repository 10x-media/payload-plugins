import { isRecord } from '../core/values'

export interface ExclusionResponse {
	/** The query parameter the tracker reads. */
	param: string
	/** The parameter's value that leaves a browser out of the scope's numbers. */
	token: string
	/**
	 * Whether this admin's own address is one of the scope's sites, where a switch can leave the
	 * browser out without a link: `null` on an unscoped install, which cannot tell.
	 */
	sameOrigin: boolean | null
	/**
	 * The scope's site addresses, as `capture.exclusion.sites` names them, each an `http(s)` origin
	 * with an optional path; empty where the install names none, and the admin cannot know them.
	 */
	sites: string[]
}

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')

/** The exclusion endpoint's answer, or null for a body of any other shape. */
export const readExclusionResponse = (body: unknown): ExclusionResponse | null =>
	isRecord(body) &&
	typeof body.param === 'string' &&
	typeof body.token === 'string' &&
	(typeof body.sameOrigin === 'boolean' || body.sameOrigin === null) &&
	isStringList(body.sites)
		? { param: body.param, token: body.token, sameOrigin: body.sameOrigin, sites: body.sites }
		: null

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
