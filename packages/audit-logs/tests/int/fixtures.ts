import type { CollectionConfig, GlobalConfig, Payload, Where } from 'payload'

export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [{ name: 'name', type: 'text' }],
}

export const tags: CollectionConfig = {
	slug: 'tags',
	fields: [{ name: 'name', type: 'text' }],
}

export const posts: CollectionConfig = {
	slug: 'posts',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'views', type: 'number' },
		{ name: 'secret', type: 'text' },
		{ name: 'internalNotes', type: 'text' },
		{ name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true },
		{
			name: 'seo',
			type: 'group',
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'description', type: 'text' },
			],
		},
		{
			name: 'sections',
			type: 'array',
			fields: [{ name: 'heading', type: 'text' }],
		},
	],
}

export const pages: CollectionConfig = {
	slug: 'pages',
	versions: { drafts: true },
	fields: [{ name: 'title', type: 'text' }],
}

export const siteSettings: GlobalConfig = {
	slug: 'site-settings',
	fields: [
		{ name: 'siteName', type: 'text' },
		{ name: 'tagline', type: 'text' },
	],
}

export const TEST_EMAIL = 'audit@example.com'
export const TEST_PASSWORD = 'password'

/** Creates the auth user every spec logs its writes against. */
export const seedUser = async (payload: Payload) => {
	return payload.create({
		collection: 'users',
		data: { email: TEST_EMAIL, password: TEST_PASSWORD, name: 'Audit User' },
	})
}

/**
 * Reads every audit log entry, newest last, bypassing the collection's closed access.
 * `depth: 0` so relationships stay the plain ids the plugin stored, which is what the
 * assertions are about.
 */
export const readLogs = async (payload: Payload, where: Where = {}) => {
	const result = await payload.find({
		collection: 'audit-logs',
		depth: 0,
		where,
		sort: 'createdAt',
		limit: 200,
		overrideAccess: true,
	})
	return result.docs as unknown as AuditLogDoc[]
}

export type AuditLogDoc = {
	id: string
	operation: 'auth' | 'create' | 'custom' | 'delete' | 'update'
	eventType?: string
	relationTo: string
	documentId?: string
	user?: unknown
	changedPaths?: string[]
	diff?: Record<string, { after: unknown; before: unknown }>
	snapshot?: Record<string, unknown>
	metadata?: Record<string, unknown>
	group?: string
	archivedAt?: string
	payloadAPI?: string
	ipAddress?: string
	userAgent?: string
}
