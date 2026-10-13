import type { Endpoint } from 'payload'

import { submitterFrom } from '../server/submitter'
import { callTenx } from '../server/tenx'
import { allow, relay } from './shared'

/** The signed-in user's own recordings and where each one stands with the team. */
export const listEndpoint = (path: string): Endpoint => ({
	method: 'get',
	path,
	handler: async (req) => {
		const allowed = await allow(req)
		if (allowed instanceof Response) return allowed
		const submitter = encodeURIComponent(submitterFrom(allowed.user).id)
		return relay(
			req,
			await callTenx({
				options: allowed.options,
				path: `/clips?submitter=${submitter}`,
				method: 'GET',
				timeoutMs: 10_000,
			})
		)
	},
})
