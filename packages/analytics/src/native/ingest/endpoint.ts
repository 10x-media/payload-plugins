import type { PayloadHandler } from 'payload'
import type { GeoResolver } from '../geo/geoResolver'
import { flushBatch } from './flushBatch'
import { normalizeEvent, type RawEventInput } from './normalizeEvent'
import { dailySalt } from './salt'

export const makeIngestHandler =
	(geoResolver: GeoResolver): PayloadHandler =>
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
		const event = await normalizeEvent({ raw, headers: req.headers, geoResolver, salt, now })
		await flushBatch(req.payload, [event])
		return Response.json({ ok: true }, { status: 202 })
	}
