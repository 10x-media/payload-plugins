import type { CollectionSlug, Payload } from 'payload'
import { EVENTS_SLUG } from '../collections/events'
import type { StoredEvent } from './normalizeEvent'

export async function writeEvent(payload: Payload, event: StoredEvent): Promise<void> {
	await payload.create({
		collection: EVENTS_SLUG as CollectionSlug,
		data: event as never,
		overrideAccess: true,
	})
}
