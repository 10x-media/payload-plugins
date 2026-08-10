import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionConfig } from 'payload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Upload target for the retention archive job. The job writes a gzipped CSV here,
 * so this collection exists purely to give `retention.archive.uploadCollection`
 * somewhere to land. It is not audited: archiving must not log itself.
 */
export const media: CollectionConfig = {
	slug: 'media',
	admin: { group: 'Audit logs' },
	upload: { staticDir: path.resolve(dirname, '../uploads') },
	fields: [{ name: 'alt', type: 'text' }],
}
