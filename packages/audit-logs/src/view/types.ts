import type { ReactNode } from 'react'

export type AuditLogDoc = {
	id: string
	operation: 'auth' | 'create' | 'custom' | 'delete' | 'update'
	eventType?: string
	relationTo: string
	documentId?: string
	user?: unknown
	impersonator?: unknown
	locale?: string
	/** Free text: core sets REST, GraphQL or local, a plugin may set anything else. */
	payloadAPI?: string
	ipAddress?: string
	userAgent?: string
	changedPaths?: string[]
	diff?: Record<string, { after: unknown; before: unknown }>
	snapshot?: unknown
	metadata?: unknown
	group?: string
	createdAt: string
}

/**
 * The view's filters as the URL carries them. Every list matches any of its
 * values; the filters combine with AND. Documents and users are `slug:id` when
 * picked, a bare id when typed in.
 */
export type Filters = {
	changedPaths?: string[]
	collections?: string[]
	dateFrom?: string
	dateTo?: string
	documents?: string[]
	eventTypes?: string[]
	globals?: string[]
	groups?: string[]
	operations?: string[]
	tenants?: string[]
	users?: string[]
}

export type SelectOption = { label: string; value: string }

/** Server-rendered custom event bodies, keyed by entry id. */
export type RenderedEvents = Record<string, ReactNode>

export type AuditLogsClientProps = {
	adminRoute: string
	apiRoute: string
	/** Every collection but the log itself, labelled from its config. */
	collectionOptions: SelectOption[]
	docs: Record<string, unknown>[]
	filters: Filters
	globalOptions: SelectOption[]
	/** Titles of the documents and users the current filters name. */
	refLabels: Record<string, string>
	/** `useAsTitle` per collection, to name what the filter drawers pick. */
	titleFields: Record<string, string>
	/** Tenant options for the filter dropdown. Only present when multiTenancy is configured. */
	tenantOptions?: SelectOption[]
	/** When set, the view is locked to this tenant ID and the tenant filter is hidden. */
	lockedTenantId?: string
	limit: number
	page: number
	totalDocs: number
	totalPages: number
	userTitleFields: Record<string, string>
	/** Value to label for the `payloadAPI` badge, built from `logs.payloadAPIs`. */
	payloadAPILabels: Record<string, string>
	/** Show debug job-trigger buttons (only when debug:true and retention is configured). */
	debugMode?: boolean
	/** Whether the archive job is configured (controls visibility of the Archive button). */
	hasArchive?: boolean
	renderedEvents?: RenderedEvents
	/** Custom event types for the Event filter and their badge labels. */
	customEventTypes: SelectOption[]
}
