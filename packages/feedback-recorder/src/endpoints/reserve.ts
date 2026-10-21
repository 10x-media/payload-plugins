import type { Endpoint, PayloadRequest } from 'payload'
import { submitterFrom } from '../server/submitter'
import { callTenx } from '../server/tenx'
import { pluginVersion } from '../server/version'
import { allow, readJson, relay } from './shared'

const KINDS = new Set(['bug', 'question', 'idea', 'feedback'])

const optionalString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined

const optionalNumber = (value: unknown): number | undefined => {
	const number = Number(value)
	return Number.isFinite(number) && number > 0 ? number : undefined
}

const siteUrlOf = (req: PayloadRequest): string | undefined => {
	const configured = req.payload.config.serverURL
	if (configured) return configured
	const origin = req.headers.get('origin')
	return origin ?? undefined
}

/**
 * Reserves a recording with the 10x system. The browser says what it recorded and why; this
 * endpoint adds who sent it (from the session, never from the browser), the site and its version,
 * and forwards it with the site's key. The answer is the Bunny upload target.
 */
export const reserveEndpoint = (path: string): Endpoint => ({
	method: 'post',
	path,
	handler: async (req) => {
		const allowed = await allow(req)
		if (allowed instanceof Response) return allowed
		const data = await readJson(req)
		const kind = optionalString(data.kind)

		const body = {
			source: data.source === 'upload' ? 'upload' : 'capture',
			title: optionalString(data.title),
			kind: kind && KINDS.has(kind) ? kind : 'feedback',
			note: optionalString(data.note),
			durationSeconds: optionalNumber(data.durationSeconds),
			sizeBytes: optionalNumber(data.sizeBytes),
			context: data.context && typeof data.context === 'object' ? data.context : undefined,
			submitter: submitterFrom(allowed.user),
			siteUrl: siteUrlOf(req),
			appVersion: allowed.options.appVersion ?? undefined,
			pluginVersion: pluginVersion() ?? undefined,
		}

		return relay(
			req,
			await callTenx({
				options: allowed.options,
				path: '/clips',
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				timeoutMs: 20_000,
			})
		)
	},
})
