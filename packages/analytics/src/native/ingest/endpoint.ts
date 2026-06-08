import type { PayloadHandler } from 'payload'
import type { GeoResolver } from '../geo/geoResolver'
import { applyRollupDeltas } from '../rollups/applyRollupDeltas'
import { computeRollupDeltas } from '../rollups/deltas'
import { normalizeEvent, type RawEventInput } from './normalizeEvent'
import { dailySalt } from './salt'
import { writeEvent } from './writeEvent'

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
		await writeEvent(req.payload, event)
		await applyRollupDeltas(req.payload, computeRollupDeltas(event))
		return Response.json({ ok: true }, { status: 202 })
	}
