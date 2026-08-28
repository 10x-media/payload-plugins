import type { Payload } from 'payload'

const DEV_USERS = [
	{ email: 'dev@10xmedia.de', password: 'password' },
	{ email: 'viewer@10xmedia.de', password: 'password' },
] as const

/**
 * Seed the dev Payload app: two users for live-list and presence e2e.
 * Idempotent per email.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	for (const user of DEV_USERS) {
		const existing = await payload.find({
			collection: 'users',
			where: { email: { equals: user.email } },
			limit: 1,
		})
		if (existing.totalDocs > 0) continue
		await payload.create({
			collection: 'users',
			data: { email: user.email, password: user.password },
		})
		payload.logger.info(`Seeded dev user: ${user.email} / ${user.password}`)
	}
}
