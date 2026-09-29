import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const HOUR = 60 * 60 * 1000

type Inline =
	| string
	| { block: 'contentLockDate'; source: string; format: string }
	| { block: 'contentLockScope' }

/** A one-paragraph Lexical message from text runs and the plugin's inline blocks. */
const message = (...parts: Inline[]) => ({
	root: {
		type: 'root',
		direction: 'ltr' as const,
		format: '' as const,
		indent: 0,
		version: 1,
		children: [
			{
				type: 'paragraph',
				direction: 'ltr' as const,
				format: '' as const,
				indent: 0,
				version: 1,
				textFormat: 0,
				children: parts.map((part, index) =>
					typeof part === 'string'
						? {
								type: 'text',
								text: part,
								detail: 0,
								format: 0,
								mode: 'normal',
								style: '',
								version: 1,
							}
						: {
								type: 'inlineBlock',
								version: 1,
								fields: {
									id: `seed-${index}`,
									blockName: '',
									blockType: part.block,
									...('source' in part ? { source: part.source, format: part.format } : {}),
								},
							}
				),
			},
		],
	},
})

/**
 * Seed the dev Payload app: an admin user, some content, and lock windows in
 * every stage: two announced (everything tomorrow, with a message in English
 * and German, and the site group in three days) so the banner pages, one
 * pending, one active on the catalog group only, so the site collections stay
 * editable, and one unpublished draft that locks nothing. Idempotent.
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
	const upgrade = await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Database upgrade',
			announceAt: at(-HOUR),
			startsAt: at(26 * HOUR),
			endAtTime: true,
			endsAt: at(30 * HOUR),
			announcementMessage: message(
				'We are moving to a new database ',
				{ block: 'contentLockDate', source: 'startsAt', format: 'relative' },
				'. ',
				{ block: 'contentLockScope' },
				' will be read-only until ',
				{ block: 'contentLockDate', source: 'endsAt', format: 'time' },
				'.'
			),
		},
	})
	await payload.update({
		collection: 'content-locks',
		id: upgrade.id,
		locale: 'de',
		data: {
			announcementMessage: message(
				'Wir ziehen auf eine neue Datenbank um, ',
				{ block: 'contentLockDate', source: 'startsAt', format: 'relative' },
				'. ',
				{ block: 'contentLockScope' },
				' sind bis ',
				{ block: 'contentLockDate', source: 'endsAt', format: 'time' },
				' schreibgeschützt.'
			),
		},
	})
	await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Website relaunch',
			announceAt: at(-HOUR),
			startsAt: at(3 * 24 * HOUR),
			lockEverything: false,
			groups: ['site'],
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
	await payload.create({
		collection: 'content-locks',
		draft: true,
		data: { title: 'Search reindex', startsAt: at(2 * HOUR) },
	})
	payload.logger.info(
		'Seeded content-lock windows: two announced, pending, active (catalog), one draft'
	)
}
