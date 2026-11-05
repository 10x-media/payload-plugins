import type { BeforeRemoveArgs } from '@10x-media/dedupe/types'

/**
 * Dev stand only: what a host writes on `hooks.beforeRemove` to move the references to the
 * customers a merge takes in. One relationship and one `hasMany` list; every other field that
 * points at customers is moved the same way. The writes go through `req`, inside the merge's
 * transaction.
 */
export const repointCustomers = async ({
	req,
	survivorId,
	absorbedIds,
}: BeforeRemoveArgs): Promise<void> => {
	const { payload } = req
	await payload.update({
		collection: 'orders',
		where: { customer: { in: absorbedIds } },
		data: { customer: survivorId },
		depth: 0,
		req,
	})

	const gone = new Set(absorbedIds.map(String))
	const { docs } = await payload.find({
		collection: 'trips',
		where: { participants: { in: absorbedIds } },
		depth: 0,
		pagination: false,
		req,
	})
	for (const trip of docs) {
		const participants: (number | string)[] = []
		for (const id of (trip.participants ?? []) as (number | string)[]) {
			const next = gone.has(String(id)) ? survivorId : id
			if (!participants.some((kept) => String(kept) === String(next))) participants.push(next)
		}
		await payload.update({
			collection: 'trips',
			id: trip.id,
			data: { participants },
			depth: 0,
			req,
		})
	}
}
