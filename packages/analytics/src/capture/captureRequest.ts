import { getDataLoader, isolateObjectProperty, type PayloadRequest } from 'payload'

/** The headers that say who is signed in. */
const IDENTITY_HEADERS = ['cookie', 'authorization'] as const

const captured = new WeakSet<PayloadRequest>()

/**
 * The request a capture call site hands the host's resolvers: no user, cookie or authorization,
 * so an editor's beacon files under its site, and its own dataloader, whose keys carry no user.
 */
export const captureRequest = (req: PayloadRequest): PayloadRequest => {
	if (captured.has(req)) {
		return req
	}
	const visitor = isolateObjectProperty(req, ['user', 'headers', 'payloadDataLoader'])
	const headers = new Headers(req.headers)
	for (const name of IDENTITY_HEADERS) {
		headers.delete(name)
	}
	visitor.user = null
	visitor.headers = headers
	visitor.payloadDataLoader = getDataLoader(visitor)
	captured.add(visitor)
	return visitor
}
