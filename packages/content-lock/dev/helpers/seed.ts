import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const HOUR = 60 * 60 * 1000

type Token = {
	token: 'startsAt' | 'endsAt' | 'announceAt' | 'scope'
	format?: 'datetime' | 'date' | 'time' | 'relative'
}

/** The dev app's `swatch` inline block, added to the editor through `editor.features`. */
type Swatch = { swatch: 'black' | 'red' | 'amber' | 'green' }

let swatchId = 0

const node = (part: string | Token | Swatch) => {
	if (typeof part === 'string') {
		return {
			type: 'text' as const,
			text: part,
			detail: 0,
			format: 0,
			mode: 'normal' as const,
			style: '',
			version: 1,
		}
	}
	if ('swatch' in part) {
		swatchId += 1
		return {
			type: 'inlineBlock' as const,
			version: 1,
			fields: { id: `seed-swatch-${swatchId}`, blockType: 'swatch' as const, color: part.swatch },
		}
	}
	return { type: 'contentLockToken' as const, version: 1, format: 'datetime' as const, ...part }
}

/** A one-paragraph Lexical message from text runs, lock value tokens and swatches. */
const message = (...parts: Array<string | Token | Swatch>) => ({
	root: {
		type: 'root' as const,
		direction: 'ltr' as const,
		format: '' as const,
		indent: 0,
		version: 1,
		children: [
			{
				type: 'paragraph' as const,
				direction: 'ltr' as const,
				format: '' as const,
				indent: 0,
				version: 1,
				textFormat: 0,
				textStyle: '',
				children: parts.map(node),
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
	const userCount = await payload.count({ collection: 'users', overrideAccess: true })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
			overrideAccess: true,
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const lockCount = await payload.count({ collection: 'content-locks', overrideAccess: true })
	if (lockCount.totalDocs > 0) {
		return
	}
	for (const title of ['Home', 'About']) {
		await payload.create({ collection: 'pages', data: { title }, overrideAccess: true })
	}
	for (const title of ['Desk lamp', 'Office chair']) {
		await payload.create({ collection: 'products', data: { title }, overrideAccess: true })
	}

	const now = Date.now()
	const at = (offset: number) => new Date(now + offset).toISOString()
	const upgrade = await payload.create({
		collection: 'content-locks',
		overrideAccess: true,
		data: {
			title: 'Database upgrade',
			announce: true,
			announceAt: at(-HOUR),
			startsAt: at(26 * HOUR),
			endAtTime: true,
			endsAt: at(30 * HOUR),
			announcementMessage: message(
				{ swatch: 'amber' },
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
		overrideAccess: true,
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
		overrideAccess: true,
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
		overrideAccess: true,
		data: {
			title: 'Quarterly cleanup',
			announce: true,
			announceAt: at(20 * 24 * HOUR),
			startsAt: at(21 * 24 * HOUR),
		},
	})
	await payload.create({
		collection: 'content-locks',
		overrideAccess: true,
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
		overrideAccess: true,
		draft: true,
		data: { title: 'Search reindex', startsAt: at(2 * HOUR) },
	})
	payload.logger.info(
		'Seeded content-lock windows: two announced, pending, active (catalog), one draft'
	)
}
