import type { Payload } from 'payload'

export const DEV_ADMIN = { email: 'dev@10xmedia.de', password: 'password' }
export const DEV_CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }
export const DEV_PARTNER = { email: 'partner@10xmedia.de', password: 'password' }

export const DEMO_NOTE_TITLE = 'Demo note'

/**
 * Seed the dev Payload app: one account per auth collection, so all three sessions can
 * be held at once, plus the note and global the frontend writes to. Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({ collection: 'users', data: DEV_ADMIN })
		payload.logger.info(`Seeded dev admin: ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`)
	}

	const customerCount = await payload.count({ collection: 'customers' })
	if (customerCount.totalDocs === 0) {
		await payload.create({
			collection: 'customers',
			data: { ...DEV_CUSTOMER, name: 'Dev Customer' },
		})
		payload.logger.info(`Seeded dev customer: ${DEV_CUSTOMER.email} / ${DEV_CUSTOMER.password}`)
	}

	const partnerCount = await payload.count({ collection: 'partners' })
	if (partnerCount.totalDocs === 0) {
		await payload.create({
			collection: 'partners',
			data: { ...DEV_PARTNER, company: 'Dev Partner GmbH' },
		})
		payload.logger.info(`Seeded dev partner: ${DEV_PARTNER.email} / ${DEV_PARTNER.password}`)
	}

	const noteCount = await payload.count({ collection: 'notes' })
	if (noteCount.totalDocs === 0) {
		await payload.create({
			collection: 'notes',
			data: { title: DEMO_NOTE_TITLE, touchCount: 0 },
		})
	}

	const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
	if (!settings.headline) {
		await payload.updateGlobal({
			slug: 'site-settings',
			data: { headline: 'Seeded headline' },
		})
	}
}
