import type { Payload } from 'payload'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const TAG_NAMES = ['alpha', 'beta', 'gamma']

/**
 * Seed the dev Payload app: an admin user, relationship targets, and one
 * document per showcase collection that already has rows to reorder and
 * delete, so undo can be exercised without first building state by hand.
 * Idempotent.
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

	const tagCount = await payload.count({ collection: 'tags' })
	if (tagCount.totalDocs === 0) {
		for (const name of TAG_NAMES) {
			await payload.create({ collection: 'tags', data: { name } })
		}
	}

	const postCount = await payload.count({ collection: 'posts' })
	if (postCount.totalDocs === 0) {
		await payload.create({
			collection: 'posts',
			data: {
				title: 'Undo/redo playground',
				summary: 'Edit anything here, then step back through the history overlay.',
				views: 3,
				status: 'draft',
				seo: {
					title: 'Playground',
					keywords: [{ word: 'undo' }, { word: 'redo' }, { word: 'history' }],
				},
				layout: [
					{ blockType: 'hero', heading: 'Hero one', cta: { label: 'Go', url: '/go' } },
					{
						blockType: 'cards',
						intro: 'Cards intro',
						cards: [{ title: 'Card A' }, { title: 'Card B' }, { title: 'Card C' }],
					},
				],
			},
		})
	}

	const nestingCount = await payload.count({ collection: 'nesting' })
	if (nestingCount.totalDocs === 0) {
		await payload.create({
			collection: 'nesting',
			data: {
				label: 'Nesting playground',
				looseAlpha: 'root level, from an unnamed group',
				named: { alpha: 'one segment deep', deep: { value: 'two segments deep' } },
				list: [
					{
						title: 'Row one',
						meta: { note: 'first' },
						nested: [{ value: 'inner one' }, { value: 'inner two' }],
					},
					{ title: 'Row two', meta: { note: 'second' }, nested: [{ value: 'inner three' }] },
					{ title: 'Row three', meta: { note: 'third' } },
				],
				sections: [{ blockType: 'hero', heading: 'Section hero' }],
			},
		})
	}

	const localizedCount = await payload.count({ collection: 'localized-docs' })
	if (localizedCount.totalDocs === 0) {
		const doc = await payload.create({
			collection: 'localized-docs',
			locale: 'en',
			data: {
				title: 'English title',
				shared: 'same in every locale',
				localizedItems: [{ label: 'English row one' }, { label: 'English row two' }],
				sharedItems: [{ sku: 'SKU-1', label: 'English label' }],
				meta: { headline: 'English headline', internalId: 'internal-1' },
			},
		})
		await payload.update({
			collection: 'localized-docs',
			id: doc.id,
			locale: 'de',
			data: {
				title: 'Deutscher Titel',
				localizedItems: [{ label: 'Deutsche Zeile' }],
				meta: { headline: 'Deutsche Überschrift' },
			},
		})
	}
}
