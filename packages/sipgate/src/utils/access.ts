import type { Access, PayloadRequest } from 'payload'

/** Collection access predicate: allow any authenticated Payload user. */
const authenticated: Access = ({ req }) => Boolean(req.user)

/**
 * Default collection access for the plugin's collections: read/create/update/delete
 * all require an authenticated Payload user. Hosts can widen or narrow this per
 * collection via the matching `overrides` key.
 */
export const authenticatedCollectionAccess: {
	read: Access
	create: Access
	update: Access
	delete: Access
} = {
	read: authenticated,
	create: authenticated,
	update: authenticated,
	delete: authenticated,
}

export type SipgateAccessFn = (req: PayloadRequest) => boolean | Promise<boolean>

export type SipgateAccess = {
	default?: SipgateAccessFn
	dial?: SipgateAccessFn
	rtcm?: SipgateAccessFn
	activeCall?: SipgateAccessFn
	devices?: SipgateAccessFn
	contacts?: SipgateAccessFn
	sync?: SipgateAccessFn
}

const defaultAccessFn: SipgateAccessFn = (req) => req.user != null

export const checkAccess = async (
	req: PayloadRequest,
	access: SipgateAccess | undefined,
	endpoint: keyof Omit<SipgateAccess, 'default'>
): Promise<Response | null> => {
	const fn = access?.[endpoint] ?? access?.default ?? defaultAccessFn
	const allowed = await fn(req)
	if (!allowed) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 })
	}
	return null
}
