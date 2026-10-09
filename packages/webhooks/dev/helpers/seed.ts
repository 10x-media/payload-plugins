import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/**
 * Signing secret of the seeded subscription, fixed so the sink in `payload.config.ts` can verify
 * what it receives the way a real receiver would. Dev only: it is public by being in this file.
 */
export const DEV_SINK_SECRET = 'whsec_d2ViaG9va3MtZGV2LXNpbmstbm90LWEtc2VjcmV0'

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
				secret: DEV_SINK_SECRET,
			},
			overrideAccess: true,
		})
		payload.logger.info(
			`Seeded webhook subscription -> /api/webhook-sink, signing with ${DEV_SINK_SECRET}`
		)
	}
}
