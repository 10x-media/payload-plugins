import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const HOUR = 60 * 60 * 1000

type Token = { token: 'startsAt' | 'endsAt' | 'announceAt' | 'scope'; format?: string }

/** A one-paragraph Lexical message from text runs and lock value tokens. */
const message = (...parts: Array<string | Token>) => ({
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
				children: parts.map((part) =>
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
						: { type: 'contentLockToken', version: 1, format: 'datetime', ...part }
				),
			},
		],
	},
})

/**
 * Seed the dev Payload app: an admin user, some content, and lock windows in
 * every stage: two announced (everything tomorrow, with a tokenized message in
 * English and German, and the site group in three days) so the banner pages, one
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
			announce: true,
			announceAt: at(-HOUR),
			startsAt: at(26 * HOUR),
			endAtTime: true,
			endsAt: at(30 * HOUR),
			announcementMessage: message(
				'We are moving to a new database ',
				{ token: 'startsAt', format: 'relative' },
				'. Content will be read-only until ',
				{ token: 'endsAt', format: 'time' },
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
				{ token: 'startsAt', format: 'relative' },
				'. Inhalte sind bis ',
				{ token: 'endsAt', format: 'time' },
				' schreibgeschützt.'
			),
		},
	})
	await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Website relaunch',
			announce: true,
			announceAt: at(-HOUR),
			startsAt: at(3 * 24 * HOUR),
			lockEverything: false,
			groups: ['site'],
			announcementMessage: message(
				'Relaunch on ',
				{ token: 'startsAt', format: 'date' },
				': ',
				{ token: 'scope' },
				' will be frozen while we move to the new design.'
			),
		},
	})
	await payload.create({
		collection: 'content-locks',
		data: {
			title: 'Quarterly cleanup',
			announce: true,
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
