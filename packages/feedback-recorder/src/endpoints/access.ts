import type { Endpoint } from 'payload'

import { getRegistry } from '../plugin/registry'
import { json } from './shared'

/**
 * Whether the signed-in user may record, answered locally without calling the 10x system. The
 * admin asks after every sign-in, because the provider that holds the recorder sits in the root
 * layout and does not re-render when a user signs in or out.
 */
export const accessEndpoint = (path: string): Endpoint => ({
	method: 'get',
	path,
	handler: async (req) => {
		const options = getRegistry(req.payload.config)
		const user = req.user
		const allowed = Boolean(
			options?.configured &&
				user &&
				(await Promise.resolve(options.access({ payload: req.payload, user })).catch(() => false))
		)
		return json({ body: { allowed }, req, status: 200 })
	},
})
