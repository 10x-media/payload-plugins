import type { PayloadRequest } from 'payload'

/**
 * True when the user signed in through `admin.user`'s collection. The default `access.read` and
 * unscoped cross-scope gate, so another auth collection reads nothing unless the host says so.
 */
export const isAdminUser = ({ req }: { req: PayloadRequest }): boolean => {
	const adminCollection = req.payload?.config?.admin?.user
	return typeof adminCollection === 'string' && req.user?.collection === adminCollection
}
