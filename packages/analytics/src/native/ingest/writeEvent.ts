import type { CollectionSlug, Payload } from 'payload'
import { EVENTS_SLUG } from '../collections/events'
import type { StoredEvent } from './normalizeEvent'

export async function writeEvent(payload: Payload, event: StoredEvent): Promise<void> {
	// `timezone` drives rollup day bucketing only; it is not a stored events column.
	const { timezone: _timezone, ...data } = event
	await payload.create({
		collection: EVENTS_SLUG as CollectionSlug,
		data: data as never,
		overrideAccess: true,
	})
}
