import type { PayloadRequest } from 'payload'

/**
 * A request the ingest handler can actually read: it buffers the body stream through the
 * capped reader rather than calling `req.json()`, so a test double needs a real Request.
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
			headers: { 'content-type': 'application/json', 'user-agent': 'UA', ...headers },
		}),
		{ payload }
	) as unknown as PayloadRequest
