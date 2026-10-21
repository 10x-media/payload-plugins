import type { Endpoint } from 'payload'

import { callTenx } from '../server/tenx'
import { allow, relay } from './shared'

/** Whether this site's key works: the "test connection" behind the recorder's settings line. */
export const statusEndpoint = (path: string): Endpoint => ({
	method: 'get',
	path,
	handler: async (req) => {
		const allowed = await allow(req)
		if (allowed instanceof Response) return allowed
		return relay(
			req,
			await callTenx({ options: allowed.options, path: '/ping', method: 'GET', timeoutMs: 10_000 })
		)
	},
})
