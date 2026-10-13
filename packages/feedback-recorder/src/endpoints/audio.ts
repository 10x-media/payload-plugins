import type { Endpoint } from 'payload'

import { submitterFrom } from '../server/submitter'
import { callTenx, SUBMITTER_HEADER } from '../server/tenx'
import { allow, clipIdFrom, json, relay } from './shared'

/** The 10x system's own cap. A microphone track is a few megabytes an hour. */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024

/**
 * Forwards the microphone-only track for transcription. Small enough to pass through this server,
 * which keeps the 10x system free of browser-facing CORS.
 */
export const audioEndpoint = (path: string): Endpoint => ({
	method: 'put',
	path,
	handler: async (req) => {
		const allowed = await allow(req)
		if (allowed instanceof Response) return allowed
		const id = clipIdFrom(req)
		if (!id) return json({ body: { error: 'invalidId' }, req, status: 400 })

		const declared = Number(req.headers.get('content-length'))
		if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
			return json({ body: { error: 'tooLarge' }, req, status: 413 })
		}
		const buffer = (await req.arrayBuffer?.()) ?? new ArrayBuffer(0)
		if (buffer.byteLength === 0) return json({ body: { error: 'empty' }, req, status: 400 })
		if (buffer.byteLength > MAX_AUDIO_BYTES) {
			return json({ body: { error: 'tooLarge' }, req, status: 413 })
		}

		return relay(
			req,
			await callTenx({
				options: allowed.options,
				path: `/clips/${id}/audio`,
				method: 'PUT',
				headers: {
					'content-type': req.headers.get('content-type') || 'audio/webm',
					[SUBMITTER_HEADER]: submitterFrom(allowed.user).id,
				},
				body: buffer,
				timeoutMs: 60_000,
			})
		)
	},
})
