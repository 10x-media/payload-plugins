import type { Payload } from 'payload'

export const DEV_ADMIN = {
	email: 'dev@10xmedia.de',
	name: 'Dev Admin',
	password: 'password',
	roles: ['admin'] as ('admin' | 'editor' | 'user')[],
}

export const DEV_EDITOR = {
	email: 'editor@10xmedia.de',
	name: 'Dev Editor',
	password: 'password',
	roles: ['editor'] as ('admin' | 'editor' | 'user')[],
}

export const DEV_USER = {
	email: 'user@10xmedia.de',
	name: 'Dev User',
	password: 'password',
	roles: ['user'] as ('admin' | 'editor' | 'user')[],
}

export const DEV_CUSTOMER = {
	email: 'customer@10xmedia.de',
	name: 'Dev Customer',
	password: 'password',
}

export const DEV_PARTNER = {
	email: 'partner@10xmedia.de',
	name: 'Dev Partner',
	password: 'password',
}

export const DEV_SSO = { email: 'sso@10xmedia.de', name: 'Dev SSO' }

/**
 * Seed every auth collection the plugin will need to exercise: staff who may
 * impersonate, a non-admin target, a second local-auth collection, an isolated
 * collection, and an SSO-only user. Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({ collection: 'users', data: DEV_ADMIN })
		payload.logger.info(`Seeded dev admin: ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`)

		await payload.create({ collection: 'users', data: DEV_EDITOR })
		payload.logger.info(`Seeded dev editor: ${DEV_EDITOR.email} / ${DEV_EDITOR.password}`)

		await payload.create({ collection: 'users', data: DEV_USER })
		payload.logger.info(`Seeded website user: ${DEV_USER.email} / ${DEV_USER.password}`)
	}

	const customerCount = await payload.count({ collection: 'customers' })
	if (customerCount.totalDocs === 0) {
		await payload.create({ collection: 'customers', data: DEV_CUSTOMER })
		payload.logger.info(`Seeded customer: ${DEV_CUSTOMER.email} / ${DEV_CUSTOMER.password}`)
	}

	const partnerCount = await payload.count({ collection: 'partners' })
	if (partnerCount.totalDocs === 0) {
		await payload.create({ collection: 'partners', data: DEV_PARTNER })
		payload.logger.info(`Seeded partner: ${DEV_PARTNER.email} / ${DEV_PARTNER.password}`)
	}

	const ssoCount = await payload.count({ collection: 'sso-users' })
	if (ssoCount.totalDocs === 0) {
		await payload.create({ collection: 'sso-users', data: DEV_SSO })
		payload.logger.info(`Seeded SSO user: ${DEV_SSO.email} (header x-dev-sso-email)`)
	}

	const postCount = await payload.count({ collection: 'posts' })
	if (postCount.totalDocs < 100) {
		const admin = (
			await payload.find({
				collection: 'users',
				limit: 1,
				pagination: false,
				where: { email: { equals: DEV_ADMIN.email } },
			})
		).docs[0]
		const editor = (
			await payload.find({
				collection: 'users',
				limit: 1,
				pagination: false,
				where: { email: { equals: DEV_EDITOR.email } },
			})
		).docs[0]
		if (postCount.totalDocs === 0) {
			await payload.create({
				collection: 'posts',
				data: { author: admin?.id, title: 'Staff only', visibility: 'staff' },
			})
			await payload.create({
				collection: 'posts',
				data: { author: editor?.id, title: 'Partner brief', visibility: 'partners' },
			})
			await payload.create({
				collection: 'posts',
				data: { author: editor?.id, title: 'Public announcement', visibility: 'public' },
			})
		}
		const visibilities = ['staff', 'partners', 'public'] as const
		const afterNamed = (await payload.count({ collection: 'posts' })).totalDocs
		for (let index = afterNamed; index < 100; index += 1) {
			const n = index + 1
			await payload.create({
				collection: 'posts',
				data: {
					author: n % 2 === 0 ? editor?.id : admin?.id,
					title: `Post ${n}`,
					visibility: visibilities[n % visibilities.length] ?? 'public',
				},
			})
		}
		payload.logger.info('Seeded posts for impersonation access checks')
	}
}
