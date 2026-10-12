import type { PayloadRequest } from 'payload'

/** Stands in for the host a real beacon carries; an event is attributed to it, not to the body. */
export const INGEST_HOST = 'h'

/** A real Request: ingest buffers the body stream through its capped reader, not `req.json()`. */
export const ingestRequest = (
	payload: unknown,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
): PayloadRequest =>
	Object.assign(
		new Request('http://localhost:3000/api/_x/e', {
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
