export type AuditLogDoc = {
	id: string
	operation: 'auth' | 'create' | 'custom' | 'delete' | 'update'
	eventType?: string
	relationTo: string
	documentId?: string
	user?: unknown
	locale?: string
	payloadAPI?: 'GraphQL' | 'REST' | 'local'
	ipAddress?: string
	userAgent?: string
	changedPaths?: string[]
	diff?: Record<string, { after: unknown; before: unknown }>
	snapshot?: unknown
	metadata?: unknown
	group?: string
	createdAt: string
}

export type Filters = {
	changedPaths?: string[]
	collections?: string[]
	dateFrom?: string
	dateTo?: string
	documentId?: string
	eventType?: string
	globals?: string[]
	group?: string
	operations?: string[]
	tenants?: string[]
	userCollection?: string // used only when user field is polymorphic (multiple auth collections)
	userIds?: string[]
}

export type SelectOption = { label: string; value: string }

export type AuditLogsClientProps = {
	adminRoute: string
	apiRoute: string
	collectionSlugs: string[]
	docs: Record<string, unknown>[]
	filters: Filters
	globalSlugs: string[]
	/** Tenant options for the filter dropdown. Only present when multiTenancy is configured. */
	tenantOptions?: SelectOption[]
	/** When set, the view is locked to this tenant ID and the tenant filter is hidden. */
	lockedTenantId?: string
	limit: number
	page: number
	totalDocs: number
	totalPages: number
	userTitleFields: Record<string, string>
	/** Show debug job-trigger buttons (only when debug:true and retention is configured). */
	debugMode?: boolean
	/** Whether the archive job is configured (controls visibility of the Archive button). */
	hasArchive?: boolean
}
