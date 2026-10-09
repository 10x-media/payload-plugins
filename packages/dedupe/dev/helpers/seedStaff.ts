import type { CollectionSlug, Payload } from 'payload'

const STAFF = 'staff' as CollectionSlug

/**
 * Dev stand only: one person entered twice, under two branches in the `tenant` field the
 * multi-tenant plugin does not scope. Idempotent.
 */
export const seedStaff = async (payload: Payload): Promise<void> => {
	const existing = await payload.count({ collection: STAFF })
	if (existing.totalDocs > 0) return
	const docs = [
		{ name: 'Oksana Melnyk', email: 'oksana.melnyk@staff.example', tenant: 'kyiv' },
		{ name: 'Oksana Melnyk', email: 'o.melnyk@staff.example', tenant: 'lviv' },
	]
	for (const data of docs) {
		await payload.create({ collection: STAFF, data: data as never, disableTransaction: true })
	}
	payload.logger.info('Seeded dev staff')
}
