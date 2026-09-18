import type { PayloadRequest } from 'payload'

/** Stands in for the host a real beacon carries; an event is attributed to it, not to the body. */
export const INGEST_HOST = 'h'

/**
 * A request the ingest handler can actually read: it buffers the body stream through the
 * capped reader rather than calling `req.json()`, so a test double needs a real Request. It
 * carries a `Host` because ingest attributes an event to the request rather than to its body.
 */
export const ingestRequest = (
	payload: unknown,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
): PayloadRequest =>
	Object.assign(
		new Request('http://localhost:3000/api/analytics/ingest', {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'content-type': 'application/json',
				'user-agent': 'UA',
				host: INGEST_HOST,
				...headers,
			},
		}),
		{ payload }
	) as unknown as PayloadRequest
