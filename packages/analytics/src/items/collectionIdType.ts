import type { Payload } from 'payload'
import { isCollectionSlug } from '../core/collectionSlug'
import type { ItemIdType } from './idType'

/**
 * A collection's id type from config alone: its own `id` field, else what the adapter generates.
 * An adapter this does not know reads as `text`, keeping every well-formed id rather than refusing.
 */
export const itemIdTypeOf = (payload: Payload, slug: string): ItemIdType => {
	const custom = isCollectionSlug(payload, slug)
		? payload.collections[slug]?.customIDType
		: undefined
	if (custom !== undefined) {
		return custom === 'number' ? 'number' : 'text'
	}
	const adapterIdType: unknown = Reflect.get(payload.db, 'idType')
	if (adapterIdType === 'uuid' || adapterIdType === 'uuidv7') {
		return 'uuid'
	}
	if (payload.db.defaultIDType === 'number') {
		return adapterIdType === 'serial' ? 'serial' : 'number'
	}
	return payload.db.name === 'mongoose' ? 'objectId' : 'text'
}

/** Every bound collection's id type, read once the database adapter exists. */
export const itemIdTypes = (
	payload: Payload,
	collections: Iterable<string>
): ReadonlyMap<string, ItemIdType> =>
	new Map([...collections].map((slug) => [slug, itemIdTypeOf(payload, slug)]))
