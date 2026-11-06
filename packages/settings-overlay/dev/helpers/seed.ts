import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/**
 * Seed the dev Payload app: an admin user, two tenants, and enough rows that every pane in the
 * overlay has something to show. Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users', overrideAccess: true })
	if (userCount.totalDocs === 0) {
		await payload.create({
			overrideAccess: true,
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const tenantCount = await payload.count({ collection: 'tenants', overrideAccess: true })
	if (tenantCount.totalDocs === 0) {
		const first = await payload.create({
			overrideAccess: true,
			collection: 'tenants',
			data: { name: 'Acme', slug: 'acme' },
		})
		await payload.create({
			overrideAccess: true,
			collection: 'tenants',
			data: { name: 'Globex', slug: 'globex' },
		})

		// Only the first tenant gets a document, so switching to the second exercises the
		// "no document yet" branch of `tenantGlobalItem`.
		await payload.create({
			overrideAccess: true,
			collection: 'site-settings',
			data: { siteName: 'Acme', tagline: 'We make everything', tenant: first.id },
		})
	}

	const tagCount = await payload.count({ collection: 'tags', overrideAccess: true })
	if (tagCount.totalDocs === 0) {
		for (const title of ['Announcements', 'Engineering', 'Design', 'Operations']) {
			await payload.create({
				overrideAccess: true,
				collection: 'tags',
				data: { colour: 'blue', title },
			})
		}
	}

	const redirectCount = await payload.count({ collection: 'redirects', overrideAccess: true })
	if (redirectCount.totalDocs === 0) {
		await payload.create({
			overrideAccess: true,
			collection: 'redirects',
			data: { from: '/old', to: '/new' },
		})
	}

	const postCount = await payload.count({ collection: 'posts', overrideAccess: true })
	if (postCount.totalDocs === 0) {
		await payload.create({
			overrideAccess: true,
			collection: 'posts',
			data: { body: 'A post that is not behind the overlay.', title: 'Hello' },
		})
	}

	const keyCount = await payload.count({ collection: 'keys', overrideAccess: true })
	if (keyCount.totalDocs === 0) {
		for (const [name, scope] of [
			['Website', 'read'],
			['Deploy bot', 'write'],
			['Support desk', 'admin'],
		] as const) {
			await payload.create({ overrideAccess: true, collection: 'keys', data: { name, scope } })
		}
	}

	const secretCount = await payload.count({ collection: 'secrets', overrideAccess: true })
	if (secretCount.totalDocs === 0) {
		await payload.create({
			overrideAccess: true,
			collection: 'secrets',
			data: { name: 'API key', value: 'sk-dev' },
		})
	}
}
