import type { CollectionSlug, Payload } from 'payload'

type UpsertByFieldOptions = {
	payload: Payload
	collection: string
	uniqueField: string
	uniqueValue: string
	// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
	data: Record<string, any>
}

export const upsertByField = async ({
	payload,
	collection,
	uniqueField,
	uniqueValue,
	data,
}: UpsertByFieldOptions): // biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
Promise<any> => {
	const existing = await payload.find({
		collection: collection as CollectionSlug,
		where: { [uniqueField]: { equals: uniqueValue } },
		limit: 1,
		overrideAccess: true,
	})

	if (existing.totalDocs > 0 && existing.docs[0]) {
		return payload.update({
			collection: collection as CollectionSlug,
			id: existing.docs[0].id,
			data,
			overrideAccess: true,
		})
	}

	return payload.create({
		collection: collection as CollectionSlug,
		data,
		overrideAccess: true,
	})
}
