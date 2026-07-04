import type { PayloadHandler, PayloadRequest } from 'payload'
import type { GeoResolver } from '../geo/geoResolver'
import { flushBatch } from './flushBatch'
import { normalizeEvent, type RawEventInput, type StoredEvent } from './normalizeEvent'
import { dailySalt } from './salt'
import type { WriteBuffer } from './writeBuffer'

export const makeIngestHandler =
	(
		geoResolver: GeoResolver,
		getBuffer: () => WriteBuffer<StoredEvent> | null = () => null,
		resolveScope?: (req: PayloadRequest) => Promise<string | null>
	): PayloadHandler =>
	async (req) => {
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
		const event = await normalizeEvent({
			raw,
			headers: req.headers,
			geoResolver,
			salt,
			now,
			scope,
		})
		const buffer = getBuffer()
		if (buffer) {
			buffer.add(event)
		} else {
			await flushBatch(req.payload, [event])
		}
		return Response.json({ ok: true }, { status: 202 })
	}
