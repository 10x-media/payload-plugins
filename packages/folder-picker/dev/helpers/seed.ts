import type { Payload } from 'payload'
import type { FolderInterface } from '../payload-types'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/**
 * Derived from the generated types rather than Payload's wide `CollectionSlug`: `folderType`
 * only accepts collections that actually declare `folders: true`, and a folder id is whatever
 * the configured adapter produces. Both narrow further whenever the dev config changes.
 */
type FolderedCollection = NonNullable<FolderInterface['folderType']>[number]
type FolderId = FolderInterface['id']

/**
 * SVG rather than a raster fixture: the picker only needs distinguishable thumbnails, and a text
 * format keeps binaries out of the repo and sharp out of the dev app's dependencies.
 */
const svg = (label: string, color: string): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">` +
	`<rect width="160" height="100" fill="${color}"/>` +
	`<text x="80" y="56" fill="#fff" font-family="sans-serif" font-size="14" text-anchor="middle">${label}</text>` +
	`</svg>`

const svgFile = (name: string, color: string) => {
	const data = Buffer.from(svg(name, color), 'utf8')
	return { data, mimetype: 'image/svg+xml', name: `${name}.svg`, size: data.byteLength }
}

type FolderArgs = {
	collections: FolderedCollection[]
	name: string
	parent?: FolderId
}

/** Creates a folder typed to `collections`, optionally nested under `parent`. Returns its id. */
const createFolder = async (
	payload: Payload,
	{ collections, name, parent }: FolderArgs
): Promise<FolderId> => {
	const doc = await payload.create({
		collection: 'payload-folders',
		data: { folder: parent ?? null, folderType: collections, name },
	})
	return doc.id
}

type UploadArgs = {
	collection: FolderedCollection
	color: string
	folder: FolderId
	name: string
}

const upload = async (
	payload: Payload,
	{ collection, color, folder, name }: UploadArgs
): Promise<void> => {
	await payload.create({
		collection,
		data: { folder },
		file: svgFile(name, color),
	})
}

/**
 * Uploads with no folder assigned. Separate from `upload` because a collection with `folders`
 * off has no `folder` field at all, so one helper cannot satisfy both shapes.
 */
const uploadUnfiled = async (
	payload: Payload,
	{ collection, color, name }: { collection: 'attachments' | 'media'; color: string; name: string }
): Promise<void> => {
	await payload.create({
		collection,
		data: {},
		file: svgFile(name, color),
	})
}

/**
 * One in-flight seed per process. `next build` collects page data with several workers and each
 * evaluates the config, so `onInit` fires more than once; a per-collection count check alone
 * still lets two runs interleave and Payload then appends a counter to every colliding filename.
 */
const globalForSeed = globalThis as typeof globalThis & {
	__10xMediaFolderPickerSeed?: Promise<void>
}

/**
 * Seed the dev Payload app: an admin user, a nested folder tree, and uploads spread across it.
 * The picker has nothing to show without folders to browse, and unfoldered documents are invisible
 * to it by design, so everything lands in a folder except the deliberate controls.
 * Idempotent: each block is skipped once its collection holds documents.
 */
export const seedDev = (payload: Payload): Promise<void> => {
	// The memo is dropped on failure. Keeping a rejected promise would hand the same rejection to
	// every later call, so one transient database hiccup would leave a long-lived `next dev` unable
	// to seed until it is restarted.
	globalForSeed.__10xMediaFolderPickerSeed ??= runSeed(payload).catch((error: unknown) => {
		globalForSeed.__10xMediaFolderPickerSeed = undefined
		throw error
	})

	return globalForSeed.__10xMediaFolderPickerSeed
}

const runSeed = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const mediaCount = await payload.count({ collection: 'media' })
	if (mediaCount.totalDocs === 0) {
		const brand = await createFolder(payload, { collections: ['media'], name: 'Brand' })
		const marketing = await createFolder(payload, { collections: ['media'], name: 'Marketing' })
		// Nested, so a test can navigate in and back out again.
		const hero = await createFolder(payload, {
			collections: ['media'],
			name: 'Hero images',
			parent: marketing,
		})
		const team = await createFolder(payload, {
			collections: ['media'],
			name: 'Team',
			parent: marketing,
		})

		const mediaFiles = [
			{ color: '#4f46e5', folder: brand, name: 'brand-logo' },
			{ color: '#0ea5e9', folder: brand, name: 'brand-mark' },
			{ color: '#f97316', folder: hero, name: 'hero-desktop' },
			{ color: '#ef4444', folder: hero, name: 'hero-mobile' },
			{ color: '#22c55e', folder: team, name: 'team-anna' },
			{ color: '#14b8a6', folder: team, name: 'team-boris' },
		]
		for (const file of mediaFiles) {
			await upload(payload, { collection: 'media', ...file })
		}
		// Deliberately unfiled: the picker hides these the way Payload's own folder view does.
		await uploadUnfiled(payload, { collection: 'media', color: '#64748b', name: 'loose-media' })

		payload.logger.info('Seeded media: Brand, Marketing/Hero images, Marketing/Team')
	}

	const filesCount = await payload.count({ collection: 'files' })
	if (filesCount.totalDocs === 0) {
		const documents = await createFolder(payload, { collections: ['files'], name: 'Documents' })
		await upload(payload, {
			collection: 'files',
			color: '#a855f7',
			folder: documents,
			name: 'spec-sheet',
		})
		await upload(payload, {
			collection: 'files',
			color: '#eab308',
			folder: documents,
			name: 'price-list',
		})
		payload.logger.info('Seeded files: Documents')
	}

	const curatedCount = await payload.count({ collection: 'curated' })
	if (curatedCount.totalDocs === 0) {
		const picks = await createFolder(payload, { collections: ['curated'], name: 'Editor picks' })
		await upload(payload, {
			collection: 'curated',
			color: '#db2777',
			folder: picks,
			name: 'curated-one',
		})
		payload.logger.info('Seeded curated: Editor picks')
	}

	const attachmentsCount = await payload.count({ collection: 'attachments' })
	if (attachmentsCount.totalDocs === 0) {
		// Folders are off for this collection, so these stay flat on purpose.
		await uploadUnfiled(payload, { collection: 'attachments', color: '#0f766e', name: 'contract' })
		await uploadUnfiled(payload, { collection: 'attachments', color: '#b45309', name: 'invoice' })
		payload.logger.info('Seeded attachments (control collection, no folders)')
	}

	const postCount = await payload.count({ collection: 'posts' })
	if (postCount.totalDocs === 0) {
		await payload.create({ collection: 'posts', data: { title: 'Picker showcase' } })
		payload.logger.info('Seeded posts: Picker showcase')
	}
}
