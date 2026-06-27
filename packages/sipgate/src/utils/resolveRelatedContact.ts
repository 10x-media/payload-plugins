import type { CollectionSlug, Payload } from 'payload'

type ResolveRelatedContactOptions = {
	payload: Payload
	contactCollections: CollectionSlug[]
	phoneNumberFields: string[]
	phoneNumber: string
}

export const resolveRelatedContact = async ({
	payload,
	contactCollections,
	phoneNumberFields,
	phoneNumber,
}: ResolveRelatedContactOptions): Promise<{ relationTo: string; value: string } | undefined> => {
	for (const collection of contactCollections) {
		const result = await payload.find({
			collection,
			where: {
				or: phoneNumberFields.map((field) => ({ [field]: { equals: phoneNumber } })),
			},
			limit: 1,
			overrideAccess: true,
		})
		if (result.totalDocs > 0) {
			const doc = result.docs[0]
			if (doc) return { relationTo: collection as string, value: doc.id as string }
		}
	}
	return undefined
}
