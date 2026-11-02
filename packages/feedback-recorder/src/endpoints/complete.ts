import type { Endpoint } from 'payload'

import { submitterFrom } from '../server/submitter'
import { callTenx, SUBMITTER_HEADER } from '../server/tenx'
import { allow, clipIdFrom, json, readJson, relay } from './shared'

/** The browser finished uploading to Bunny; the 10x system marks the clip processing. */
export const completeEndpoint = (path: string): Endpoint => ({
	method: 'post',
	path,
	handler: async (req) => {
		const allowed = await allow(req)
		if (allowed instanceof Response) return allowed
		const id = clipIdFrom(req)
		if (!id) return json({ body: { error: 'invalidId' }, req, status: 400 })
		const data = await readJson(req)
		const duration = Number(data.durationSeconds)

		return relay(
			req,
			await callTenx({
				options: allowed.options,
				path: `/clips/${id}/complete`,
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SUBMITTER_HEADER]: submitterFrom(allowed.user).id,
				},
				body: JSON.stringify(
					Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}
				),
				timeoutMs: 20_000,
			})
		)
	},
})
