import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const ensureForm = async (
	payload: Payload,
	title: string,
	data: Record<string, unknown>
): Promise<void> => {
	const existing = await payload.count({ collection: 'forms', where: { title: { equals: title } } })
	if (existing.totalDocs > 0) {
		return
	}
	await payload.create({ collection: 'forms', data: { title, ...data } })
	payload.logger.info(`Seeded form: ${title}`)
}

/**
 * Seed the dev Payload app: an admin user plus two demo forms the `(frontend)` pages render and the e2e
 * suite drives -- a multi-step contact form (a conditional field, a required consent, required-field
 * validation) and a single-choice poll with public results. Idempotent (keyed on title).
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

	await ensureForm(payload, 'Demo Contact', {
		fields: [
			{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
			{
				blockType: 'select',
				name: 'role',
				label: 'Role',
				options: [
					{ label: 'Developer', value: 'dev' },
					{ label: 'Other', value: 'other' },
				],
			},
			{
				blockType: 'text',
				name: 'otherRole',
				label: 'Please specify',
				visibleWhen: { or: [{ and: [{ role: { equals: 'other' } }] }] },
			},
			{
				blockType: 'consent',
				name: 'terms',
				label: 'I agree to the terms',
				source: 'static',
				sourceConfig: { label: 'Terms of Service', url: 'https://example.com/terms' },
			},
		],
		flow: {
			steps: [
				{ id: 'step1', fields: ['fullName', 'email'], next: 'step2' },
				{ id: 'step2', fields: ['role', 'otherRole', 'terms'] },
			],
		},
	})

	await ensureForm(payload, 'Favorite framework', {
		fields: [
			{
				blockType: 'select',
				name: 'framework',
				label: 'Favorite framework',
				required: true,
				options: [
					{ label: 'Payload', value: 'payload' },
					{ label: 'Strapi', value: 'strapi' },
					{ label: 'Sanity', value: 'sanity' },
				],
			},
		],
		poll: { enabled: true, resultsField: 'framework' },
	})
}
