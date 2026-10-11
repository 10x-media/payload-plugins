import type { Endpoint, Payload, PayloadRequest } from 'payload'

/** The handler mounted at `path` under `routes.api`; throws when no endpoint is mounted there. */
export const handlerAt = (payload: Payload, path: string): NonNullable<Endpoint['handler']> => {
	const endpoint = (payload.config.endpoints ?? []).find(
		(each): each is Endpoint => typeof each === 'object' && each.path === path
	)
	if (!endpoint || typeof endpoint.handler !== 'function') {
		throw new Error(`no endpoint is mounted at ${path}`)
	}
	return endpoint.handler
}

/**
 * A GET of the endpoint mounted at `path`, as Payload's router hands it over: `user` is whoever
 * the request authenticated as, and an anonymous request leaves it out.
 */
export const callEndpoint = async (
	payload: Payload,
	call: { path: string; query: string | URLSearchParams; user?: unknown }
): Promise<Response> =>
	handlerAt(
		payload,
		call.path
	)({
		payload,
		user: call.user,
		url: `http://localhost/api${call.path}?${call.query}`,
		headers: new Headers(),
	} as unknown as PayloadRequest)
