import type { CollectionSlug, Payload } from 'payload'
import { flattenTopLevelFields } from 'payload'
import { normalizePhoneVariants } from './normalizePhone'

type ResolveRelatedContactOptions = {
	payload: Payload
	contactCollections: CollectionSlug[]
	phoneNumberFields: string[]
	phoneNumber: string
}

type ContactHit = {
	collection: CollectionSlug
	id: string
	createdAt: string
}

const topLevelFieldNames = (payload: Payload, collection: CollectionSlug): Set<string> => {
	const fields = payload.collections[collection]?.config?.fields
	if (!fields) return new Set()
	return new Set(
		flattenTopLevelFields(fields)
			.map((f) => ('name' in f ? f.name : undefined))
			.filter((name): name is string => Boolean(name))
	)
}

export const resolveRelatedContact = async ({
	payload,
	contactCollections,
	phoneNumberFields,
	phoneNumber,
}: ResolveRelatedContactOptions): Promise<{ relationTo: string; value: string } | undefined> => {
	const variants = normalizePhoneVariants(phoneNumber)

	const settled = await Promise.all(
		contactCollections.map(async (collection): Promise<ContactHit | null> => {
			try {
				const available = topLevelFieldNames(payload, collection)
				const fields = phoneNumberFields.filter((field) => available.has(field))
				if (!fields.length) return null

				const result = await payload.find({
					collection,
					where: {
						or: fields.flatMap((field) => variants.map((v) => ({ [field]: { equals: v } }))),
					},
					sort: '-createdAt',
					limit: 1,
					overrideAccess: true,
				})
				const doc = result.docs[0]
				if (!doc) return null
				return {
					collection,
					id: doc.id as string,
					createdAt: (doc as unknown as Record<string, string>).createdAt ?? '',
				}
			} catch {
				return null
			}
		})
	)

	const hits = settled.filter((h): h is ContactHit => h !== null)
	if (!hits.length) return undefined

	hits.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

	const best = hits[0]
	if (!best) return undefined

	return { relationTo: best.collection as string, value: best.id }
}
