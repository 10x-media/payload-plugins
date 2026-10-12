import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionConfig } from 'payload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Images for the specimens' upload fields. */
export const media: CollectionConfig = {
	slug: 'media',
	upload: { staticDir: path.resolve(dirname, '../uploads') },
	fields: [{ name: 'alt', type: 'text' }],
}
