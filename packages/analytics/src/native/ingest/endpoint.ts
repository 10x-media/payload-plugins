import type { PayloadHandler, PayloadRequest } from 'payload'
import type { GeoResolver } from '../geo/geoResolver'
import { flushBatch } from './flushBatch'
import { normalizeEvent, type RawEventInput, type StoredEvent } from './normalizeEvent'
import { dailySalt } from './salt'
import type { WriteBuffer } from './writeBuffer'

export interface IngestResolvers {
	scope?: (req: PayloadRequest) => Promise<string | null>
	timezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
}

export const makeIngestHandler =
	(
		geoResolver: GeoResolver,
		getBuffer: () => WriteBuffer<StoredEvent> | null = () => null,
		resolvers: IngestResolvers = {}
	): PayloadHandler =>
	async (req) => {
		const { scope: resolveScope, timezone: resolveTimezone } = resolvers
		const ct = req.headers.get('content-type') ?? ''
		const raw = (
			ct.startsWith('application/json')
				? await req.json?.()
				: JSON.parse((await req.text?.()) ?? '{}')
		) as RawEventInput
		if (!raw?.path || !raw?.hostname || (raw.type !== 'pageview' && raw.type !== 'event')) {
			return Response.json({ error: 'invalid payload' }, { status: 400 })
		}
		const now = new Date()
		const salt = await dailySalt(req.payload, now)
		const scope = resolveScope ? ((await resolveScope(req)) ?? '') : undefined
		const timezone = resolveTimezone ? await resolveTimezone(req, scope ?? null) : undefined
		const event = await normalizeEvent({
			raw,
			headers: req.headers,
			geoResolver,
			salt,
			now,
			scope,
			timezone,
		})
		const buffer = getBuffer()
		if (buffer) {
			buffer.add(event)
		} else {
			await flushBatch(req.payload, [event])
		}
		return Response.json({ ok: true }, { status: 202 })
	}
