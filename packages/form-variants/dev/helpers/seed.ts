import type { Payload } from 'payload'

const ADMIN_EMAIL = 'dev@10xmedia.de'
const EDITOR_EMAIL = 'editor@10xmedia.de'
const PASSWORD = 'password'

/** One paragraph as Lexical writes it, so a seeded rich text field opens with something in it. */
const paragraphs = (...texts: string[]) => ({
	root: {
		type: 'root',
		children: texts.map((text) => ({
			type: 'paragraph',
			children: [
				{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 },
			],
			direction: 'ltr' as const,
			format: '' as const,
			indent: 0,
			textFormat: 0,
			version: 1,
		})),
		direction: 'ltr' as const,
		format: '' as const,
		indent: 0,
		version: 1,
	},
})

/**
 * Seed the dev Payload app: an admin and an editor to log in with, companies, a few people so
 * the duplicate check has something to find, job openings for the showcase collection, an event
 * to edit and a secret the editor cannot open. Each collection is seeded only while empty.
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

	const openingCount = await payload.count({ collection: 'openings' })
	if (openingCount.totalDocs === 0) {
		const acme = await payload.find({
			collection: 'companies',
			depth: 0,
			limit: 1,
			where: { name: { equals: 'Acme' } },
		})
		const ada = await payload.find({
			collection: 'people',
			depth: 0,
			limit: 1,
			where: { lastName: { equals: 'Lovelace' } },
		})
		const company = acme.docs[0]?.id
		const hiringManager = ada.docs[0]?.id

		await payload.create({
			collection: 'openings',
			data: {
				_status: 'published',
				applyBy: '2026-11-30T00:00:00.000Z',
				benefits: ['learning-budget', 'sabbatical'],
				company,
				compensation: { currency: 'EUR', equity: true, max: 95000, min: 75000 },
				department: 'engineering',
				description: paragraphs(
					'We run a small platform team behind a product a few thousand companies depend on every day. You would own the parts of it that have to stay up while everything around them changes.',
					'The stack is TypeScript end to end, Postgres, and as little else as we can get away with.'
				),
				employmentType: 'full-time',
				headcount: 2,
				hiringManager,
				internalNotes: 'Backfill for the two leavers in Q3. Budget signed off by finance.',
				interviewStages: [
					{ minutes: 30, name: 'Intro call' },
					{ minutes: 90, name: 'System design' },
					{ minutes: 60, name: 'Team conversation' },
				],
				location: { city: 'Berlin', country: 'Germany', office: 'Acme GmbH' },
				officeDays: 2,
				referralBonus: 2000,
				requirements: [
					{ item: 'Several years on a production TypeScript service', mustHave: true },
					{ item: 'Comfortable owning a database schema', mustHave: true },
					{ item: 'Has run an incident review', mustHave: false },
				],
				responsibilities: [
					{ item: 'Own the ingestion pipeline end to end' },
					{ item: 'Keep the API contract stable across releases' },
					{ item: 'Share the on-call rota with four others' },
				],
				seniority: 'senior',
				status: 'open',
				summary:
					'Own the services behind our ingestion pipeline. Small team, long-lived product, and a schema you will still recognise in two years.',
				timezones: 'CET ± 3 hours',
				title: 'Senior Backend Engineer',
				workplace: 'hybrid',
			},
		})

		await payload.create({
			collection: 'openings',
			data: {
				_status: 'published',
				applyBy: '2026-10-15T00:00:00.000Z',
				benefits: ['four-day-week', 'learning-budget'],
				company,
				compensation: { currency: 'EUR', equity: false, max: 78000, min: 60000 },
				department: 'design',
				description: paragraphs(
					'The product has grown faster than its design language. This role is about putting one back together without stopping the releases.'
				),
				employmentType: 'full-time',
				headcount: 1,
				hiringManager,
				location: { city: 'Lisbon', country: 'Portugal', office: 'Acme Unipessoal Lda' },
				requirements: [
					{ item: 'A portfolio of shipped product work, not concepts', mustHave: true },
					{ item: 'Has maintained a design system in production', mustHave: false },
				],
				responsibilities: [
					{ item: 'Take the design system from folklore to documentation' },
					{ item: 'Sit in on customer calls every week' },
				],
				seniority: 'mid',
				status: 'open',
				summary:
					'Bring one design language back to a product that has outgrown its own. Fully remote across European time zones.',
				timezones: 'WET to EET',
				title: 'Product Designer',
				workplace: 'remote',
			},
		})

		await payload.create({
			collection: 'openings',
			data: {
				_status: 'draft',
				compensation: { currency: 'EUR', max: 55000, min: 45000 },
				department: 'marketing',
				employmentType: 'contract',
				headcount: 1,
				internalNotes: 'Waiting on the Q1 budget before this goes out.',
				location: { city: 'Munich', country: 'Germany' },
				seniority: 'mid',
				status: 'paused',
				summary: 'Six months to rewrite the documentation that everyone complains about.',
				title: 'Developer Educator',
				workplace: 'onsite',
			},
		})
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
