import { getDataLoader, isolateObjectProperty, type PayloadRequest } from 'payload'
import { fetchSiteOf, requestOrigin } from './requestTrust'

/**
 * The request as the Origin's own site would have sent it: its host headers and address name the
 * Origin's host, everything else is the request's. `origin` is already normalized.
 */
const asOriginRequest = (req: PayloadRequest, origin: string): PayloadRequest => {
	const { host } = new URL(origin)
	const twin = isolateObjectProperty(req, ['headers', 'url', 'payloadDataLoader'])
	const headers = new Headers(req.headers)
	headers.set('host', host)
	if (headers.has('x-forwarded-host')) {
		headers.set('x-forwarded-host', host)
	}
	twin.headers = headers
	if (req.url) {
		const url = new URL(req.url)
		// `url` is read-only on Request's type; the isolated proxy keeps its own copy all the same.
		Reflect.set(twin, 'url', `${origin}${url.pathname}${url.search}`)
	}
	twin.payloadDataLoader = getDataLoader(twin)
	return twin
}

/**
 * Whether a sibling subdomain's page (`Sec-Fetch-Site: same-site`) posted for another scope than
 * the request's. An Origin no scope answers for passes, so a split deployment's page host posts.
 */
export const refusedSameSite = async (
	req: PayloadRequest,
	scope: () => Promise<string | null>,
	resolve: (req: PayloadRequest) => Promise<string | null>
): Promise<boolean> => {
	if (fetchSiteOf(req.headers) !== 'same-site') {
		return false
	}
	const origin = requestOrigin(req.headers)
	if (origin === null) {
		return false
	}
	const fromOrigin = await resolve(asOriginRequest(req, origin))
	return fromOrigin !== null && fromOrigin !== (await scope())
}
