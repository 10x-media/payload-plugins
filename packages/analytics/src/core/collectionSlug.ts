import type { CollectionSlug, Payload } from 'payload'

/** Whether the instance registered a collection under `slug`. */
export const isCollectionSlug = (payload: Payload, slug: string): slug is CollectionSlug =>
	Object.hasOwn(payload.collections, slug)
