import type { Payload, PayloadRequest } from 'payload'

/**
 * A request from an admin-collection user, whom every read admits by default (`access.read` is
 * `isAdminUser`), for driving a widget or display field read without an endpoint.
 */
export const readerRequest = (
	payload: Payload,
	extra: Record<string, unknown> = {}
): PayloadRequest =>
	({
		payload,
		user: { id: 'reader', collection: payload.config.admin.user },
		headers: new Headers(),
		...extra,
	}) as unknown as PayloadRequest
