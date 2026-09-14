import type { Payload } from 'payload'

const ADMIN_EMAIL = 'dev@10xmedia.de'
const EDITOR_EMAIL = 'editor@10xmedia.de'
const PASSWORD = 'password'

/**
 * Seed the dev Payload app: an admin and an editor to log in with, companies, a few people so
 * the duplicate check has something to find, an event to edit and a secret the editor cannot
 * open. Each collection is seeded only while empty.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: ADMIN_EMAIL, password: PASSWORD, role: 'admin' },
		})
		await payload.create({
			collection: 'users',
			data: { email: EDITOR_EMAIL, password: PASSWORD, role: 'editor' },
		})
		payload.logger.info(`Seeded dev admin: ${ADMIN_EMAIL} / ${PASSWORD}`)
		payload.logger.info(`Seeded dev editor: ${EDITOR_EMAIL} / ${PASSWORD}`)
	}

	const companyCount = await payload.count({ collection: 'companies' })
	if (companyCount.totalDocs === 0) {
		const acme = await payload.create({ collection: 'companies', data: { name: 'Acme' } })
		await payload.create({ collection: 'companies', data: { name: 'Globex' } })

		const peopleCount = await payload.count({ collection: 'people' })
		if (peopleCount.totalDocs === 0) {
			await payload.create({
				collection: 'people',
				data: {
					dateOfBirth: '1984-03-12',
					email: 'ada@example.com',
					employer: acme.id,
					firstName: 'Ada',
					gender: 'female',
					lastName: 'Lovelace',
					position: 'Engineer',
				},
			})
			await payload.create({
				collection: 'people',
				data: {
					dateOfBirth: '1990-07-01',
					email: 'grace@example.com',
					firstName: 'Grace',
					gender: 'female',
					lastName: 'Hopper',
				},
			})
		}
	}

	const eventCount = await payload.count({ collection: 'events' })
	if (eventCount.totalDocs === 0) {
		await payload.create({
			collection: 'events',
			data: {
				format: 'in-person',
				sessions: [
					{ minutes: 30, speaker: 'Ada Lovelace', title: 'Opening' },
					{ minutes: 45, speaker: 'Grace Hopper', title: 'Compilers, then and now' },
				],
				startsAt: '2026-10-15T09:00:00.000Z',
				title: 'Payload meetup',
				venue: { city: 'Berlin', name: 'Factory', street: 'Rheinsberger Str. 76' },
			},
		})
	}

	const secretCount = await payload.count({ collection: 'secrets' })
	if (secretCount.totalDocs === 0) {
		await payload.create({
			collection: 'secrets',
			data: { label: 'Staging API key', value: 'sk_test_123' },
		})
	}
}
