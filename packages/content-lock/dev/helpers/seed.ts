import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const HOUR = 60 * 60 * 1000

/**
 * Seed the dev Payload app: an admin user, some content, and one lock window
 * per stage (pending, announced, active on the catalog group only, so the site
 * collections stay editable). Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const lockCount = await payload.count({ collection: 'content-locks' })
	if (lockCount.totalDocs > 0) {
		return
	}
	for (const title of ['Home', 'About']) {
		await payload.create({ collection: 'pages', data: { title } })
	}
	for (const title of ['Desk lamp', 'Office chair']) {
		await payload.create({ collection: 'products', data: { title } })
	}

	const now = Date.now()
	const at = (offset: number) => new Date(now + offset).toISOString()
	await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Database upgrade',
			announceAt: at(-HOUR),
			startsAt: at(26 * HOUR),
			endAtTime: true,
			endsAt: at(30 * HOUR),
		},
	})
	await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Quarterly cleanup',
			announceAt: at(20 * 24 * HOUR),
			startsAt: at(21 * 24 * HOUR),
		},
	})
	await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Catalog import',
			startsAt: at(-HOUR),
			endAtTime: true,
			endsAt: at(2 * HOUR),
			lockEverything: false,
			groups: ['catalog'],
		},
	})
	payload.logger.info('Seeded content-lock windows: announced, pending, active (catalog)')
}
