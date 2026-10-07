import type { PayloadRequest } from 'payload'

/**
 * Default access for both collections: a user of the collection that signs in to the admin panel.
 *
 * "Any logged-in user" is too wide for these two. An app with a second auth collection (customers,
 * members) would let every one of those users read the delivery log, which stores the full body of
 * every document a watched collection emitted, and register a subscription pointing wherever they
 * like. Hosts whose operators live in another collection widen it through `overrides.access`.
 */
export const adminUser = ({ req }: { req: PayloadRequest }): boolean =>
	Boolean(req.user) && req.user?.collection === req.payload.config.admin.user
