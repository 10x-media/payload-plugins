import type { Access, CollectionConfig, CollectionSlug, RelationshipField } from 'payload'

// biome-ignore lint/complexity/useMaxParams: the collection shape is driven by six independent plugin options; an options object is queued as a port follow-up
export const buildAuditLogsCollection = (
	hidden = true,
	userRelationTo: CollectionSlug | CollectionSlug[] = 'users',
	access?: { create?: Access; delete?: Access; read?: Access; update?: Access },
	tenantsSlug?: string,
	archiveEnabled = false,
	groupEnabled = false
): CollectionConfig => {
	return {
		slug: 'audit-logs',
		admin: {
			hidden,
			defaultColumns: ['relationTo', 'operation', 'user', 'createdAt'],
		},
		access: {
			create: access?.create ?? (() => false),
			delete: access?.delete ?? (() => false),
			read: access?.read ?? (() => false),
			update: access?.update ?? (() => false),
		},
		fields: [
			{
				name: 'operation',
				type: 'select',
				required: true,
				options: [
					{ label: 'Create', value: 'create' },
					{ label: 'Update', value: 'update' },
					{ label: 'Delete', value: 'delete' },
					{ label: 'Auth', value: 'auth' },
					{ label: 'Custom', value: 'custom' },
				],
				index: true,
			},
			{
				// Populated for 'auth' (login, forgot_password) and 'custom' operations
				name: 'eventType',
				type: 'text',
				admin: {
					condition: (data) => data.operation === 'custom' || data.operation === 'auth',
				},
				index: true,
			},
			{
				// The collection or global slug the log entry relates to
				name: 'relationTo',
				type: 'text',
				required: true,
				index: true,
				admin: {
					position: 'sidebar',
				},
			},
			{
				// null for globals and custom events without a specific document
				name: 'documentId',
				type: 'text',
				index: true,
				admin: {
					position: 'sidebar',
				},
			},

			{
				name: 'user',
				type: 'relationship',
				relationTo: userRelationTo,
				hasMany: false,
				admin: {
					position: 'sidebar',
				},
				index: true,
			} as RelationshipField,
			{
				name: 'locale',
				type: 'text',
				admin: {
					position: 'sidebar',
				},
				index: true,
			},
			{
				// 'GraphQL' | 'local' | 'REST', useful to distinguish server-side vs user-initiated changes
				// Note that changes from admin panel are always from REST api
				name: 'payloadAPI',
				type: 'select',
				options: [
					{ label: 'REST', value: 'REST' },
					{ label: 'GraphQL', value: 'GraphQL' },
					{ label: 'Local', value: 'local' },
				],
				admin: {
					position: 'sidebar',
				},
			},
			{
				// Client IP, extracted from x-forwarded-for or x-real-ip headers
				name: 'ipAddress',
				type: 'text',
				admin: {
					position: 'sidebar',
				},
			},
			{
				name: 'userAgent',
				type: 'text',
				admin: {
					position: 'sidebar',
				},
			},
			{
				// Flat list of dot-notation paths that changed, e.g. ['details.score', 'status']
				// hasMany text avoids generating an id per item (unlike array type)
				name: 'changedPaths',
				type: 'text',
				hasMany: true,
				index: true,
			},
			{
				// Flat diff keyed by path: { 'details.score': { before: 2, after: 1 } }
				name: 'diff',
				type: 'json',
			},
			{
				// Full document snapshot, populated on create (snapshotOnCreate) or delete (snapshotOnDelete)
				name: 'snapshot',
				type: 'json',
			},
			{
				// User-defined data for custom events
				name: 'metadata',
				type: 'json',
			},
			...(groupEnabled
				? [
						{
							name: 'group',
							type: 'text' as const,
							index: true,
						},
					]
				: []),
			...(archiveEnabled
				? [
						{
							name: 'archivedAt',
							type: 'date' as const,
							admin: { hidden: true },
							index: true,
						},
					]
				: []),
			...(tenantsSlug
				? [
						{
							name: 'tenant',
							type: 'relationship' as const,
							relationTo: tenantsSlug as CollectionSlug,
							hasMany: false as const,
							index: true,
							admin: {
								position: 'sidebar' as const,
							},
						},
					]
				: []),
		],
	}
}
