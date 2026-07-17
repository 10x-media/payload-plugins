import type { CollectionSlug, Payload } from 'payload'

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

const ensurePage = async (
	payload: Payload,
	collection: CollectionSlug,
	data: Record<string, unknown>
): Promise<number | string> => {
	const existing = await payload.find({
		collection,
		where: { slug: { equals: data.slug } },
		limit: 1,
		depth: 0,
	})
	const found = existing.docs[0]
	if (found) {
		return found.id
	}
	const created = await payload.create({ collection, data })
	payload.logger.info(`Seeded ${collection}: ${String(data.slug)}`)
	return created.id
}

const statement = (text: string) => ({
	root: {
		type: 'root',
		format: '' as const,
		indent: 0,
		version: 1,
		direction: 'ltr' as const,
		children: [
			{
				type: 'paragraph',
				format: '' as const,
				indent: 0,
				version: 1,
				direction: 'ltr' as const,
				children: [
					{ type: 'text', text, format: 0, style: '', detail: 0, mode: 'normal', version: 1 },
				],
			},
		],
	},
})

/**
 * The consent statements this app's forms reference, on the `settings` global where the plugin's
 * `consent.sources` resolver reads them. `privacy` points at a drafts-enabled page, so its proofs
 * pin a published version; `marketing` points at a version-less notice, so its proofs carry a page
 * and no version. Idempotent (skips once any row exists).
 */
const seedConsentSources = async (payload: Payload): Promise<void> => {
	const current = await payload.findGlobal({ slug: 'settings', depth: 0 })
	if (((current.consentSources ?? []) as unknown[]).length > 0) {
		return
	}
	const privacyId = await ensurePage(payload, 'legal-pages', {
		title: 'Privacy Policy',
		slug: 'privacy',
		_status: 'published',
	})
	const marketingId = await ensurePage(payload, 'notices', {
		title: 'Marketing Preferences',
		slug: 'marketing',
	})
	await payload.updateGlobal({
		slug: 'settings',
		data: {
			consentSources: [
				{
					key: 'privacy',
					label: 'Privacy policy',
					statement: statement('I have read and agree to the privacy policy'),
					page: { relationTo: 'legal-pages', value: privacyId as string },
				},
				{
					key: 'marketing',
					label: 'Marketing emails',
					statement: statement('Send me occasional product news'),
					page: { relationTo: 'notices', value: marketingId as string },
				},
			],
		},
	})
	payload.logger.info('Seeded consent sources: privacy, marketing')
}

const ATHLETES: { name: string; discipline: string; country: string }[] = [
	{ name: 'Mara Vieira', discipline: 'Sprint', country: 'Brazil' },
	{ name: 'Jonas Keller', discipline: 'Marathon', country: 'Germany' },
	{ name: 'Aiko Tanaka', discipline: 'Sprint', country: 'Japan' },
	{ name: 'Liam Byrne', discipline: 'Middle distance', country: 'Ireland' },
	{ name: 'Nadia Haddad', discipline: 'Hurdles', country: 'Morocco' },
	{ name: 'Sven Larsson', discipline: 'Long jump', country: 'Sweden' },
	{ name: 'Priya Nair', discipline: 'Sprint', country: 'India' },
	{ name: 'Diego Morales', discipline: 'Marathon', country: 'Mexico' },
	{ name: 'Zoe Bennett', discipline: 'Hurdles', country: 'Australia' },
	{ name: 'Kofi Mensah', discipline: 'Sprint', country: 'Ghana' },
]

// The first four athletes are the ones this form makes voteable; the rest exist but never appear as
// choices, which is the whole point of the demo.
const VOTEABLE_NAMES = ATHLETES.slice(0, 4).map((athlete) => athlete.name)

/** Seed the ten athletes the `athleteVote` field draws from. Idempotent (skips once any exist). */
const seedAthletes = async (payload: Payload): Promise<void> => {
	const existing = await payload.count({ collection: 'athletes' })
	if (existing.totalDocs > 0) {
		return
	}
	for (const data of ATHLETES) {
		await payload.create({ collection: 'athletes', data })
	}
	payload.logger.info(`Seeded ${ATHLETES.length} athletes`)
}

/**
 * Seed the dev Payload app: an admin user, the consent sources and the policy pages they reference,
 * an `athletes` collection, plus demo forms the `(frontend)` pages render and the e2e suite drives --
 * a multi-step contact form (a conditional field, a required consent, required-field validation), a
 * single-choice poll with public results, and a relationship-backed poll whose `athleteVote` field
 * makes four of the seeded athletes voteable (its `resolveOptions` sources the choices, the winner
 * select, and the results labels from those records). Idempotent (keyed on title).
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

	await seedConsentSources(payload)
	await seedAthletes(payload)

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
			{ blockType: 'consent', name: 'terms', source: 'privacy', required: true },
			{ blockType: 'consent', name: 'news', source: 'marketing' },
		],
		flow: {
			steps: [
				{ id: 'step1', fields: ['fullName', 'email'], next: 'step2' },
				{ id: 'step2', fields: ['role', 'otherRole', 'terms', 'news'] },
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

	const voteable = await payload.find({
		collection: 'athletes',
		where: { name: { in: VOTEABLE_NAMES } },
		depth: 0,
		limit: VOTEABLE_NAMES.length,
	})
	const voteableIds = voteable.docs.map((athlete) => athlete.id)
	await ensureForm(payload, 'Who will win?', {
		fields: [
			{
				blockType: 'athleteVote',
				name: 'pick',
				label: 'Cast your vote',
				required: true,
				athletes: voteableIds,
			},
		],
		poll: { enabled: true, resultsField: 'pick' },
	})
}
