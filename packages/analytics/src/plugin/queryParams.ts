import type { PayloadRequest } from 'payload'

/** A request's query parameters, read off `req.url`; a request without one has none. */
export const queryParams = (req: Pick<PayloadRequest, 'url'>): URLSearchParams =>
	new URL(req.url ?? '', 'http://localhost').searchParams
