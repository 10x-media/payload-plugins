import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const subs = await payload.count({ collection: 'webhook-subscriptions' })
	if (subs.totalDocs === 0) {
		const serverURL = payload.config.serverURL || 'http://localhost:3000'
		await payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'Local sink',
				url: `${serverURL}/api/webhook-sink`,
				enabled: true,
				events: ['posts.created'],
			},
			overrideAccess: true,
		})
		payload.logger.info('Seeded webhook subscription -> /api/webhook-sink')
	}
}
