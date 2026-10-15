import type {
	Access,
	CollectionConfig,
	CollectionSlug,
	GlobalSlug,
	PayloadComponent,
	PayloadRequest,
	RelationshipField,
	StaticLabel,
	Where,
} from 'payload'

type JobBase = { id: number | string }

export type ArchiveJobHooks = {
	/** Called once before the archive job begins processing. */
	beforeRun?: (args: { req: PayloadRequest; job: JobBase }) => Promise<void> | void
	/**
	 * Called after each page of logs is written to the CSV stream.
	 * Use this for heartbeats, progress tracking, or per-batch logging.
	 *
	 * @example heartbeat
	 * afterBatch: async ({ req, job }) => {
	 *   await updateJobHeartbeat(req.payload, job.id, job.meta)
	 * }
	 */
	afterBatch?: (args: {
		req: PayloadRequest
		job: JobBase
		/** Current page number (1-based). */
		page: number
		/** Number of docs processed in this batch. */
		docsInBatch: number
		/** Running total of docs processed so far. */
		totalProcessed: number
	}) => Promise<void> | void
	/** Called once after all logs are archived and marked. Receives final stats. */
	afterRun?: (args: {
		req: PayloadRequest
		job: JobBase
		/** Total number of logs archived in this run. 0 if nothing to archive. */
		archived: number
		/** Filename of the created archive, or null if nothing was archived. */
		filename: string | null
	}) => Promise<void> | void
}

export type DeleteJobHooks = {
	/** Called once before the delete job begins. */
	beforeRun?: (args: { req: PayloadRequest; job: JobBase }) => Promise<void> | void
	/**
	 * Called after each batch of logs is deleted.
	 * Use this for heartbeats on large datasets.
	 */
	afterBatch?: (args: {
		req: PayloadRequest
		job: JobBase
		/** Number of docs deleted in this batch. */
		docsInBatch: number
		/** Running total deleted so far. */
		totalDeleted: number
	}) => Promise<void> | void
	/** Called once after all deletions complete. */
	afterRun?: (args: {
		req: PayloadRequest
		job: JobBase
		/** Total number of logs deleted in this run. */
		deleted: number
	}) => Promise<void> | void
}

export type DataRetentionConfig = {
	/**
	 * Cron expression for the delete job.
	 * Each run deletes all logs that have been archived (when `archive` is configured),
	 * or all logs unconditionally (when used without `archive`).
	 * Should run less frequently than `archive.cron`.
	 *
	 * @example '0 3 1 * *' (first day of each month at 3 AM)
	 * @example '0 3 * * 0' (every Sunday at 3 AM)
	 */
	deleteCron: string
	/**
	 * Additional filter applied to the delete job. Merged with the base condition
	 * (`archivedAt IS NOT NULL` when archive is configured, or no condition otherwise).
	 * Use this to scope deletion to a subset of logs.
	 *
	 * @example
	 * // Delete only logs for the 'posts' and 'pages' collections
	 * where: { relationTo: { in: ['posts', 'pages'] } }
	 *
	 * @example
	 * // Delete everything except 'entries' logs
	 * where: { relationTo: { not_in: ['entries'] } }
	 */
	deleteWhere?: Where
	/** Lifecycle hooks for the delete job. */
	deleteHooks?: DeleteJobHooks
	/**
	 * Queue name used for both archive and delete tasks.
	 * Must match the queue name in your autoRun / bin script configuration.
	 * @default 'audit-retention'
	 */
	queue?: string
	archive?: {
		/**
		 * Cron expression for the archive job.
		 * Each run archives all logs not yet archived (`archivedAt IS NULL`).
		 * Should run more frequently than `deleteCron`.
		 *
		 * @example '0 2 * * 0' (every Sunday at 2 AM)
		 * @example '0 2 1,15 * *' (twice a month, 1st and 15th, at 2 AM)
		 */
		cron: string
		/**
		 * Payload upload collection where compressed CSV archives are stored.
		 */
		uploadCollection: CollectionSlug
		/**
		 * Additional filter applied to the archive job. Merged with `archivedAt IS NULL`.
		 * Use this to scope archiving to a subset of logs.
		 *
		 * @example
		 * // Archive only logs for the 'posts' and 'pages' collections
		 * where: { relationTo: { in: ['posts', 'pages'] } }
		 *
		 * @example
		 * // Archive everything except 'entries' logs
		 * where: { relationTo: { not_in: ['entries'] } }
		 */
		where?: Where
		/**
		 * Per-collection anonymize functions applied to diff and snapshot values before archiving.
		 * Falls back to `pluginOptions.anonymize[collection]` if not set here.
		 */
		anonymize?: Partial<Record<CollectionSlug | GlobalSlug, AnonymizeFunction>>
		/**
		 * Populate additional fields on the upload document created for each archive run.
		 * Use this when your upload collection has required fields that the plugin cannot know about.
		 *
		 * The returned object is merged into `data` when calling `payload.create` on the upload
		 * collection. The `file` itself (name, mimetype, size, buffer) is always set by the plugin.
		 *
		 * @example
		 * populateUploadFields: ({ filename, runDate, logCount }) => ({
		 *   alt: `Audit archive ${filename}`,
		 *   folder: 'audit-archives',
		 * })
		 */
		populateUploadFields?: (args: {
			/** The generated filename, e.g. `audit-logs-2024-06-01.csv.gz` */
			filename: string
			/** Number of log entries included in this archive */
			logCount: number
			/** The date/time the archive job ran */
			runDate: Date
		}) => Record<string, unknown>
		/**
		 * Fields to exclude from the CSV archive columns.
		 * Any field present on an audit log document that is listed here will be omitted from the CSV.
		 * Supports both built-in plugin fields and any user-defined fields added via `logs.override`.
		 *
		 * By default `ipAddress` and `userAgent` are excluded to avoid storing PII in archives.
		 * Pass an empty array to include every field.
		 *
		 * @default ['ipAddress', 'userAgent']
		 *
		 * @example
		 * // Include IP and user-agent but strip a custom `requestBody` field
		 * excludeFields: ['requestBody']
		 */
		excludeFields?: string[]
		/** Lifecycle hooks for the archive job. */
		hooks?: ArchiveJobHooks
		/**
		 * Override the default archive filename base. The `.csv.gz` extension is always appended
		 * by the plugin, do not include it in the return value.
		 *
		 * @default `audit-logs-{YYYY-MM-DD}` → `audit-logs-{YYYY-MM-DD}.csv.gz`
		 *
		 * @example
		 * generateFilename: ({ runDate }) =>
		 *   `audit-logs-${runDate.toISOString().slice(0, 7)}` // → audit-logs-2024-06.csv.gz
		 */
		generateFilename?: (args: {
			/** Number of log entries included in this archive */
			logCount: number
			/** The date/time the archive job ran */
			runDate: Date
		}) => string
	}
}

/**
 * Access function for the audit logs view.
 * Unlike Payload's `Access` type, this cannot return a Where query, only boolean.
 * Only `req` is available (no collection/id/data context).
 */
export type ViewAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

/**
 * Props a custom event renderer receives. A server component additionally gets
 * `payload` and `req`, so it can look up whatever the metadata points at.
 */
export type CustomEventComponentProps = {
	/** The collection or global slug the event was recorded against. */
	collection: string
	/** ISO timestamp of the entry. */
	createdAt: string
	documentId?: string
	/** The whole entry as the view read it, `user` populated. */
	entry: Record<string, unknown>
	eventType: string
	metadata?: Record<string, unknown>
}

/**
 * Renderers for the expanded body of custom events, keyed by `eventType`, with
 * `'*'` as the fallback for every type. An explicit `false` keeps the default
 * table and JSON block, wildcard included.
 */
export type CustomEventComponents = Record<string, PayloadComponent | false>

/**
 * Who an entry ran as, the way the view resolved it. A user that no longer exists keeps
 * its stored id and slug, with `deleted` set and the id as its label.
 */
export type AuditLogUser = {
	deleted: boolean
	id: string
	label: string
	slug: string
}

/**
 * Whatever `view.loadContext` returned for the page, handed unchanged to every slot.
 * `undefined` when no loader is configured. A client component receives it across the
 * server boundary, so keep it serializable.
 */
export type AuditLogsViewContext = Record<string, unknown> | undefined

/**
 * Builds a link to the view with one more value added to a filter from `view.filters`,
 * keeping every filter already applied. Use it to make a badge narrow the list the way
 * the tenant badge does.
 */
export type FilterHrefFunction = (name: string, value: string) => string

/**
 * Server props every view slot receives on top of its own props. A client component
 * gets none of these.
 */
export type AuditLogsSlotServerProps = {
	filterHref: FilterHrefFunction
	payload: PayloadRequest['payload']
	req: PayloadRequest
}

/**
 * Props of the slots rendered once per entry: `user`, `rowBadges`, `beforeRowDetails`
 * and `afterRowDetails`. A client component in one of them can also read whether its row
 * is expanded with `useAuditLogRow` from `@10x-media/audit-logs/client`.
 */
export type AuditLogsRowSlotProps = {
	context: AuditLogsViewContext
	/** The whole entry as the view read it, every field the collection has. */
	entry: Record<string, unknown>
	impersonator?: AuditLogUser
	user?: AuditLogUser
}

/** What `useAuditLogRow` returns to a client component inside a row slot. */
export type AuditLogRowState = {
	/** The row's entry, the same object the slot received as `entry`. */
	entry: Record<string, unknown>
	expanded: boolean
	/** Opens or closes the row, the same as clicking it. */
	setExpanded: (expanded: boolean) => void
}

/** Props of the slots rendered once per page: `beforeList` and `afterList`. */
export type AuditLogsListSlotProps = {
	context: AuditLogsViewContext
	/** The entries on the current page, in display order. */
	entries: Record<string, unknown>[]
}

/**
 * Loads data for the page's slots once, so a slot rendered per entry needs no query of
 * its own. Runs after the page's entries are read.
 *
 * @example
 * // Current department names for every department the page's entries mention
 * loadContext: async ({ entries, req }) => {
 *   const ids = [...new Set(entries.flatMap((e) => e.actorDepartments ?? []))]
 *   const { docs } = await req.payload.find({
 *     collection: 'departments',
 *     where: { id: { in: ids } },
 *     pagination: false,
 *     depth: 0,
 *   })
 *   return { departments: Object.fromEntries(docs.map((d) => [d.id, d])) }
 * }
 */
export type LoadViewContextFunction = (args: {
	entries: Record<string, unknown>[]
	req: PayloadRequest
}) => AuditLogsViewContext | Promise<AuditLogsViewContext>

/** A filter backed by documents of one collection, picked like the User filter. */
export type RelationshipViewFilter = {
	type: 'relationship'
	/** Key in the URL (`?f.<name>=<id>`) and the name `filterHref` takes. Unique among `view.filters`. */
	name: string
	label: StaticLabel
	/**
	 * Field on the `audit-logs` collection the filter matches with `in`. A text, hasMany
	 * text or relationship field all work. Must exist once `logs.override` has run.
	 */
	path: string
	/** Collection the drawer lists and the pills take their titles from. */
	relationTo: CollectionSlug
}

/**
 * A filter the view offers beside its own, declared rather than built. Values inside one
 * filter match any of them, and it combines with the others with AND.
 */
export type ViewFilter = RelationshipViewFilter

/**
 * Adds fields to an entry before it is written. Runs for every entry, CRUD, auth and
 * custom alike, inside the plugin's own write, so entries still go straight to the
 * database adapter.
 *
 * The returned fields must exist on the collection (add them with `logs.override`).
 * They cannot replace a field the plugin sets: a built-in key in the result is ignored.
 * Return `undefined` to add nothing.
 *
 * Keep it cheap: it runs inside the audited operation's transaction, once per entry.
 *
 * @example
 * // The departments the acting user belonged to at the time. Checked against
 * // `data.user`: a refused login has `req.user` but no `user` on the entry, and
 * // `createAuditEvent` may name someone else.
 * extend: ({ data, req }) =>
 *   data.user?.relationTo === 'users' && data.user.value === String(req.user?.id)
 *     ? { actorDepartments: (req.user.departments ?? []).map(String) }
 *     : undefined
 */
export type ExtendEntryFunction = (args: {
	/**
	 * The entry as the plugin built it. Read only. `user` is who the entry is attributed
	 * to, absent for a refused login or a write with nobody signed in.
	 */
	data: Readonly<{
		operation: 'auth' | 'create' | 'custom' | 'delete' | 'update'
		user?: { relationTo: string; value: string }
		[key: string]: unknown
	}>
	req: PayloadRequest
}) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>

// ---------- Audit Log types ----------

/**
 * Sentinel value returned from an AnonymizeFunction to indicate the field value should not be
 * written to the diff. The change is still recorded in changedPaths.
 */
export const REDACTED = '__REDACTED__' as const
export type RedactedValue = typeof REDACTED

export type AnonymizeFunction = (args: {
	/** A global slug when the entity being anonymized is a global, matching the `anonymize` map. */
	collection: CollectionSlug | GlobalSlug
	/** Empty string for globals, which have no document id. */
	documentId: number | string
	operation: 'create' | 'delete' | 'update'
	path: string
	redacted: RedactedValue
	value: unknown
}) => unknown

/**
 * Per-event decision function. Return `false` to skip writing the audit log entry.
 * Called after the diff is computed, `changedPaths` is always available for `update`,
 * and is an empty array for `create` and `delete`.
 *
 * Entries with no changed paths are already skipped before this function is called,
 * so `changedPaths` will never be empty for `update` operations.
 *
 * @example
 * // Skip local-API updates that only touch system/sync fields
 * shouldLog: ({ req, operation, changedPaths }) => {
 *   if (operation === 'update' && req.payloadAPI === 'local') {
 *     const systemFields = new Set(['syncedAt', 'externalId'])
 *     return changedPaths.some(p => !systemFields.has(p))
 *   }
 *   return true
 * }
 */
export type ShouldLogFunction = (args: {
	req: PayloadRequest
	operation: 'create' | 'delete' | 'update'
	doc: Record<string, unknown>
	previousDoc: Record<string, unknown> | undefined
	/** Flat dot-notation diff with normalized values (populated relationships collapsed to IDs).
	 *  Always `{}` for `create` and `delete`, only meaningful for `update`. */
	diff: Record<string, { before: unknown; after: unknown }>
	changedPaths: string[]
}) => boolean | Promise<boolean>

/**
 * Audit log configuration for globals. Only `drafts`, `excludeFields`, and `shouldLog`
 * are applicable, globals are always `update`-only and never have create/delete snapshots.
 */
export type GlobalAuditLogConfig = Pick<
	CollectionAuditLogConfig,
	'drafts' | 'excludeFields' | 'shouldLog'
>

export type CollectionAuditLogConfig = {
	/**
	 * Controls how draft saves are handled when the collection has `versions.drafts` enabled.
	 *
	 * - `'ignore'`, skip draft saves entirely (but always log `create`); on publish, diff is
	 *   computed against the last published version (via `findVersions`) rather than the last
	 *   draft (default)
	 * - `'log'`, log every save, including autosave drafts
	 *
	 * Can also be set as a top-level plugin default via `AuditPluginConfig.drafts`.
	 * Per-collection value takes precedence.
	 *
	 * @default 'ignore'
	 */
	drafts?: 'ignore' | 'log'
	/**
	 * Fields to exclude from the diff entirely. Will not appear in changedPaths or diff.
	 * `updatedAt` is always excluded regardless of this value.
	 * @default []
	 */
	excludeFields?: string[]
	/**
	 * Which operations to log.
	 * @default ['create', 'update', 'delete']
	 */
	operations?: Array<'create' | 'delete' | 'update'>
	/**
	 * Per-event decision function. Return `false` (or a Promise resolving to `false`) to skip
	 * writing the audit log entry entirely.
	 *
	 * Called after the diff is computed, so `changedPaths` is always populated for `update`
	 * (entries with no changed paths are already discarded before this function runs).
	 * For `create` and `delete`, `changedPaths` is an empty array.
	 *
	 * @example
	 * // Skip local-API updates that only touch internal sync fields
	 * shouldLog: ({ req, operation, changedPaths }) => {
	 *   if (operation === 'update' && req.payloadAPI === 'local') {
	 *     const syncFields = new Set(['syncedAt', 'externalId'])
	 *     return changedPaths.some(p => !syncFields.has(p))
	 *   }
	 *   return true
	 * }
	 */
	shouldLog?: ShouldLogFunction
	/**
	 * When true, the full created document is stored in `snapshot` instead of writing a
	 * null→value diff for every field. Cleaner than a noisy create diff.
	 * @default false
	 */
	snapshotOnCreate?: boolean
	/**
	 * When true, the full document is stored in `snapshot` on delete.
	 * Useful for partial recovery. Anonymized fields will still be redacted.
	 * @default false
	 */
	snapshotOnDelete?: boolean
}

export type OverrideFunction = (incomingField: RelationshipField) => RelationshipField

export type AuditFieldsCreateOptions = {
	/**
	 * Pass-through for any Payload relationship field admin options.
	 * Merged on top of the plugin defaults (`readOnly: true`, custom `Field` component).
	 * `admin.components.Field` takes precedence over the plugin's custom component.
	 */
	admin?: RelationshipField['admin']
	/**
	 * When true, skips registering the custom read-only field component and falls back
	 * to Payload's default relationship field UI.
	 * @default false
	 */
	disableCustomComponent?: boolean
	/**
	 * The label displayed above the field in the admin UI.
	 */
	label: RelationshipField['label']
	/**
	 * The field name used in the database and form state.
	 */
	name: string
	/**
	 * The collection(s) this field relates to.
	 */
	relationTo: CollectionSlug | CollectionSlug[]
}

type AuditFieldAutomaticOptions = {
	isManual?: false
	/**
	 * Override any property of the generated field.
	 * The function receives the fully built field and should return the modified version.
	 * Note: `hasMany` is always forced to false and cannot be overridden.
	 *
	 * @example
	 * overrides: (field) => ({ ...field, access: { update: () => false } })
	 */
	overrides?: OverrideFunction
} & Partial<AuditFieldsCreateOptions>

type AuditFieldManualOptions = {
	isManual: true
	/**
	 * Whether the field relates to multiple collections (polymorphic).
	 * When true, the hook will write `{ relationTo, value }` instead of a plain ID.
	 * @default false
	 */
	isPolymorphic?: boolean
	/**
	 * The full path to the field including the field name.
	 * Example: 'groupField.subField.fieldName'
	 */
	path: string
	/**
	 * The collection(s) this field relates to.
	 * Used to validate that the current user belongs to one of these collections before writing.
	 * If not provided, defaults to all detected auth collections.
	 */
	relationTo?: CollectionSlug | CollectionSlug[]
}

/**
 * Options for a single audit field.
 *
 * - `false`, disables the field entirely
 * - `AuditFieldAutomaticOptions`, plugin creates and manages the field automatically
 * - `AuditFieldManualOptions`, field is defined manually; plugin only writes to it via hooks
 */
export type AuditFieldOptions = AuditFieldAutomaticOptions | AuditFieldManualOptions | false

type AuditFieldsOptions =
	| true
	| false
	| {
			createdBy?: AuditFieldOptions
			lastModifiedBy?: AuditFieldOptions
	  }

/**
 * Per-collection audit configuration.
 *
 * - `true`, enable both `auditFields` and `auditLog` with defaults
 * - object, opt-in: only what is explicitly set is enabled
 */
/** As much as Payload will say about why it refused a login. */
export type FailedLoginReason = 'invalid_credentials' | 'locked' | 'unverified'

/**
 * Decides whether one refused login becomes a row. Returning `false` drops it, which is
 * the seam for collapsing a burst into one entry, or for alerting instead of recording.
 */
export type FailedLoginShouldLogFunction = (args: {
	/** The email or username submitted, capped in length. Undefined when neither was sent. */
	identifier: string | undefined
	reason: FailedLoginReason
	req: PayloadRequest
}) => boolean | Promise<boolean>

export type FailedLoginOptions = {
	shouldLog?: FailedLoginShouldLogFunction
}

/**
 * Login and password-reset logging for an auth-enabled collection.
 *
 * - `true`, log logins and password resets
 * - `false` or omitted, log neither
 * - object, pick per event
 *
 * `failedLogin` is never part of `true` and has to be named. The other two follow a
 * request that already succeeded, while a refused login is a write anyone on the internet
 * can trigger, at any rate they can send.
 */
export type AuthEventsOptions =
	| boolean
	| {
			/**
			 * Refused login attempts, recorded as `eventType: 'failed_login'`.
			 *
			 * Payload answers the same way whether or not the account exists, so the entry
			 * carries no user, only the submitted identifier and the reason.
			 *
			 * - `true`, record every refused attempt
			 * - object, the same plus a `shouldLog` filter
			 *
			 * Read the security note in the docs before enabling this on a public-facing
			 * auth collection.
			 */
			failedLogin?: boolean | FailedLoginOptions
			forgotPassword?: boolean
			login?: boolean
	  }

export type AuditOptions =
	| true
	| {
			/**
			 * Login and password-reset events. Only meaningful on a collection with `auth`.
			 * Omitted means neither is logged, in line with every other option here.
			 */
			auth?: AuthEventsOptions
			/**
			 * Configuration for the `createdBy` and `lastModifiedBy` fields.
			 * - `true`, enable both fields with defaults
			 * - `false`, disable both fields (same as omitting)
			 * - object, granular control over each field; omitted fields are disabled
			 */
			auditFields?: AuditFieldsOptions
			/**
			 * Configuration for CRUD audit log entries.
			 * - `true`, enable with all operations and defaults
			 * - `false`, disable (same as omitting)
			 * - object, granular control
			 */
			auditLog?: true | false | CollectionAuditLogConfig
	  }

/**
 * Per-global audit configuration.
 *
 * - `true`, enable both `auditFields` and `auditLog` with defaults
 * - object, opt-in: only what is explicitly set is enabled
 *
 * Note: globals are always `update`-only. `operations`, `snapshotOnCreate`, and
 * `snapshotOnDelete` from `CollectionAuditLogConfig` do not apply here.
 */
export type GlobalAuditOptions =
	| true
	| {
			auditFields?: AuditFieldsOptions
			auditLog?: true | false | GlobalAuditLogConfig
	  }

/**
 * Top-level defaults applied to all automatic audit fields across every collection and global.
 * Per-collection / per-global options take precedence over these.
 */
export type AuditFieldDefaultOptions = Omit<AuditFieldAutomaticOptions, 'isManual'>

/** One entry of `logs.payloadAPIs`, resolved to `{ label, value }`. */
export type PayloadAPIOptionObject = { label: string; value: string }

/** A `logs.payloadAPIs` entry. A bare string is used as both value and label. */
export type PayloadAPIOption = PayloadAPIOptionObject | string

/** A `logs.eventTypes` entry. A bare string is used as both value and label. */
export type EventTypeOption = { label: string; value: string } | string

export type MultiTenancyConfig = {
	/**
	 * The slug of the tenants collection. Matches `tenantsSlug` in the multi-tenant plugin.
	 * @default 'tenants'
	 */
	tenantsSlug?: string
	/**
	 * The name of the tenant relationship field on tenant-scoped documents.
	 * Matches `tenantField.name` in the multi-tenant plugin.
	 * @default 'tenant'
	 */
	tenantFieldName?: string
	/**
	 * The tenant-scoped collections, in the shape `@payloadcms/plugin-multi-tenant`
	 * takes them, so one object can be passed to both plugins. When set, only these
	 * collections (and the tenants collection) record a tenant, and
	 * `excludeCollections` is not consulted. A collection with `isGlobal: true` is
	 * one document per tenant; the tenant view offers it as a global.
	 *
	 * Without it, any collection with a field named `tenantFieldName` records one.
	 *
	 * @example
	 * const collections = { notes: {}, settings: { isGlobal: true } }
	 * multiTenantPlugin({ collections })
	 * auditLogs({ multiTenancy: { collections } })
	 */
	collections?: Partial<Record<CollectionSlug, { isGlobal?: boolean }>>
	/**
	 * Collections to exclude from tenant capture.
	 * Useful when a collection has a field named after `tenantFieldName` for unrelated reasons -
	 * e.g. a super-admin-only collection that uses a `tenant` field with different semantics.
	 * Logs for excluded collections will not have a tenant value and won't appear in the tenant view.
	 */
	excludeCollections?: CollectionSlug[]
	/**
	 * Globals to exclude from tenant capture (same rationale as excludeCollections).
	 */
	excludeGlobals?: GlobalSlug[]
	/**
	 * Tenant-scoped audit log view.
	 * When configured (or `true`), the plugin registers a separate view that always filters
	 * by the currently selected tenant (read from the `payload-tenant` cookie).
	 * Set to `false` to disable this view entirely.
	 *
	 * @default { path: '/audit-logs-tenant' }
	 */
	tenantView?:
		| true
		| false
		| {
				/**
				 * Path to the tenant-scoped view. Relative to the admin route.
				 * @default '/audit-logs-tenant'
				 */
				path?: `/${string}`
				/**
				 * Access control for the tenant-scoped view. Returns boolean only.
				 * @default ({ req }) => Boolean(req.user)
				 */
				access?: ViewAccess
		  }
}

export type AuditPluginConfig = {
	/**
	 * Default draft handling for all collections and globals that have `versions.drafts` enabled.
	 * Can be overridden per-collection/global via `auditLog.drafts`.
	 *
	 * - `'ignore'`, skip draft saves; on publish, diff is computed against the last
	 *   published version (default)
	 * - `'log'`, log every save, including autosave drafts
	 *
	 * @default 'ignore'
	 */
	drafts?: 'ignore' | 'log'
	/**
	 * Set to `false` to disable automatic relationship normalization.
	 * By default the plugin builds a field map from each collection's config and uses it
	 * to normalize relationship fields to plain IDs in both diffs and snapshots.
	 * Disable if you need populated objects preserved in snapshots, or to opt out entirely.
	 *
	 * @default true
	 */
	normalizeRelationships?: boolean
	/**
	 * Configuration for the audit-logs collection itself.
	 */
	logs?: {
		/**
		 * Override the generated `audit-logs` collection config.
		 * Receives the fully built collection and should return the modified version.
		 * The `slug` is always forced back to `'audit-logs'`, `custom.contentLock` to
		 * `{ exempt: true }` so `@10x-media/content-lock` never freezes the log, and
		 * `custom.auditLogs` to the plugin's own runtime settings. Everything else is up to you.
		 *
		 * Use this to add fields, attach hooks, customize access, etc.
		 *
		 * @example
		 * override: (collection) => ({
		 *   ...collection,
		 *   hooks: {
		 *     ...collection.hooks,
		 *     afterChange: [...(collection.hooks?.afterChange ?? []), myHook],
		 *   },
		 * })
		 */
		override?: (collection: CollectionConfig) => CollectionConfig
		/**
		 * Adds your own fields to every entry before it is written, such as what the acting
		 * user belonged to at the time. Declare the fields with `override`. Unlike a hook
		 * attached there, this keeps entries on the direct database write.
		 *
		 * @example
		 * extend: ({ data, req }) =>
		 *   data.user?.value === String(req.user?.id)
		 *     ? { actorDepartments: req.user?.departments?.map(String) }
		 *     : undefined
		 */
		extend?: ExtendEntryFunction
		/**
		 * Extra values for the `payloadAPI` field, shown in the audit logs view.
		 *
		 * `payloadAPI` records which API the audited request came in through. Core sets
		 * `'REST'`, `'GraphQL'` or `'local'`, but a plugin may augment `PayloadRequest` and
		 * set its own, the way `@payloadcms/plugin-mcp` sets `'MCP'`. The field is stored as
		 * free text precisely so an unknown value can never fail the write, and these entries
		 * only give the view something better than the raw value to render.
		 *
		 * A bare string is its own label. Naming a built-in value relabels it in place.
		 *
		 * @example
		 * payloadAPIs: ['MCP', { label: 'Server-side', value: 'local' }]
		 */
		payloadAPIs?: PayloadAPIOption[]
		/**
		 * Custom event types (`createAuditEvent`) the view offers in its Event filter,
		 * and the label each shows with in the filter and on the row badge. Types with a
		 * renderer in `view.components.customEvents` are offered without being listed.
		 * Anything else is still reachable through the filter's free text entry.
		 *
		 * A bare string is its own label.
		 *
		 * @example
		 * eventTypes: ['order_paid', { label: 'Refund', value: 'order_refunded' }]
		 */
		eventTypes?: EventTypeOption[]
		/**
		 * Whether to collect the requester's IP address and store it on each audit log entry.
		 * Set to `false` if you do not want IP addresses stored (e.g. for GDPR compliance).
		 * @default true
		 */
		ipAddress?: boolean
		/**
		 * Whether to collect the requester's User-Agent string and store it on each audit log entry.
		 * Set to `false` to omit it entirely.
		 * @default true
		 */
		userAgent?: boolean
		/**
		 * Whether to hide the audit-logs collection from the admin navigation.
		 * Set to `false` to make logs browsable in the admin panel.
		 * @default true
		 */
		hidden?: boolean
		/**
		 * Access control for the audit-logs collection.
		 * All operations are disabled by default.
		 * Plugin hooks are overriding the access control anyway.
		 *
		 * Use this to customize the access control for the audit-logs collection if needed. (e.g to allow crud operations on the audit-logs collection via rest api)
		 */
		access?: {
			create?: Access
			delete?: Access
			read?: Access
			update?: Access
		}
		/**
		 * When enabled, a `group` text field (indexed) is added to the `audit-logs` collection.
		 * On every audit log write the plugin reads `req.context[contextKey]` and stores the value.
		 *
		 * Set the context key before triggering operations to group all resulting log entries:
		 * ```ts
		 * req.context.auditGroup = crypto.randomUUID()
		 * ```
		 *
		 * - `true`, enable with the default context key `'auditGroup'`
		 * - `{ contextKey }`, use a custom key on `req.context`
		 */
		group?: boolean | { contextKey?: string }
		/**
		 * View configuration for the audit-logs collection.
		 * This view is enabled by default.
		 * pass false to disable the view.
		 */
		view?:
			| {
					/**
					 * Access control for the audit-logs view.
					 * Returns boolean only, cannot return a Where query.
					 * Only `req` is available (no collection/id/data context).
					 * @default ({ req }) => Boolean(req.user)
					 */
					access?: ViewAccess
					/**
					 * Default number of entries per page.
					 * @default 25
					 */
					defaultLimit?: number
					/**
					 * Path to the audit-logs view. Relative to the admin route.
					 * @default '/audit-logs'
					 */
					path?: `/${string}`
					/**
					 * A Payload `Where` query that is always merged (AND) into every request made by this view,
					 * regardless of what the user selects in the filter bar.
					 *
					 * Use this to scope the built-in view to a subset of logs, for example, to a specific
					 * collection, tenant, or event type. For fully custom views, pass `forceWhere` directly
					 * as a `serverProps` entry when registering the view component.
					 *
					 * @example
					 * // Only show logs for the 'orders' collection
					 * forceWhere: { relationTo: { equals: 'orders' } }
					 */
					forceWhere?: Where
					/**
					 * Filters the view offers beside its own, over fields you add to the
					 * collection. They sit under More filters and live in the URL as
					 * `?f.<name>=<value>`.
					 *
					 * @example
					 * filters: [
					 *   {
					 *     type: 'relationship',
					 *     name: 'department',
					 *     label: { en: 'Department', de: 'Abteilung' },
					 *     path: 'actorDepartments',
					 *     relationTo: 'departments',
					 *   },
					 * ]
					 */
					filters?: ViewFilter[]
					/**
					 * Loads data once per page for the slots in `components`, which receive
					 * it as `context`.
					 */
					loadContext?: LoadViewContextFunction
					/**
					 * Custom renderers for parts of the view. Every slot may be a server
					 * component, which also receives `payload`, `req` and `filterHref`.
					 */
					components?: {
						/**
						 * Rendered above the list, below the filters. Props: `AuditLogsListSlotProps`.
						 */
						beforeList?: PayloadComponent[]
						/**
						 * Rendered below the list, above the pagination. Props: `AuditLogsListSlotProps`.
						 */
						afterList?: PayloadComponent[]
						/**
						 * Extra badges on each row, after the built-in ones (API, locale,
						 * tenant). Props: `AuditLogsRowSlotProps`. Render nothing to add no badge.
						 */
						rowBadges?: PayloadComponent[]
						/**
						 * Extra sections at the top of an expanded row, before the request
						 * details. They do not make a row expandable on their own: the view
						 * cannot tell whether a server component will render anything until it
						 * has. Props: `AuditLogsRowSlotProps`.
						 */
						beforeRowDetails?: PayloadComponent[]
						/**
						 * Extra sections at the bottom of an expanded row, after the diff,
						 * snapshot and event details. Like `beforeRowDetails`, they do not make
						 * a row expandable on their own. Props: `AuditLogsRowSlotProps`.
						 */
						afterRowDetails?: PayloadComponent[]
						/**
						 * The body of a popover the user pill opens from a chevron segment, for
						 * more about who acted. Under impersonation the chevron follows the
						 * `impersonated` mark, which keeps its own popover. The pill and its link
						 * stay the plugin's. Rendered for deleted users
						 * too, which is where data from `logs.extend` matters most.
						 * Props: `AuditLogsRowSlotProps`.
						 */
						user?: PayloadComponent
						/**
						 * Replaces the event table and metadata JSON of custom events
						 * (`createAuditEvent`). Keyed by `eventType`, `'*'` matches every type.
						 *
						 * @example
						 * customEvents: {
						 *   order_refunded: '/components/RefundEvent#RefundEvent',
						 *   '*': '/components/AnyEvent#AnyEvent',
						 *   export_downloaded: false,
						 * }
						 */
						customEvents?: CustomEventComponents
					}
			  }
			| false
	}
	/**
	 * Anonymization functions per collection. Called for each changed field value before writing
	 * to the diff. Return `REDACTED` to omit the value while still recording the path as changed.
	 */
	anonymize?: Partial<Record<CollectionSlug | GlobalSlug, AnonymizeFunction>>
	/**
	 * Collections to add audit fields and/or audit log to.
	 * Keys are collection slugs; values are the audit configuration for that collection.
	 */
	collections?: Partial<Record<CollectionSlug, AuditOptions>>
	/**
	 * Default options applied to all automatic audit fields across every collection and global.
	 * Per-collection / per-global options take precedence.
	 *
	 * @example
	 * defaults: {
	 *   createdBy: { admin: { hidden: true } },
	 *   lastModifiedBy: { label: 'Modified By' },
	 * }
	 */
	defaults?: {
		createdBy?: AuditFieldDefaultOptions
		lastModifiedBy?: AuditFieldDefaultOptions
	}
	/**
	 * Multi-tenancy support. Configure when using `@payloadcms/plugin-multi-tenant` or any
	 * setup where documents have a tenant relationship field.
	 *
	 * - `true`, enable with all defaults (`tenantsSlug: 'tenants'`, `tenantFieldName: 'tenant'`)
	 * - object, explicit configuration
	 *
	 * When configured, the plugin reads the tenant from each audited document and stores it
	 * on the audit log entry. A tenant-scoped view is also registered (unless disabled).
	 */
	multiTenancy?: true | MultiTenancyConfig
	/**
	 * Records who was impersonating on each entry written under `@10x-media/impersonation`,
	 * in an `impersonator` field beside `user`.
	 *
	 * - omitted, on when `@10x-media/impersonation` is in `config.plugins`, in any order
	 * - `false`, never add the field, even with the plugin installed
	 * - `true`, add it without the plugin, for code that sets `req.user._impersonation` itself
	 *
	 * The value is read off `req.user._impersonation`, so with the impersonation plugin's
	 * `decorateRequests: false` the field exists but stays empty.
	 */
	impersonation?: boolean
	/**
	 * Set to `true` to disable all plugin behaviour while keeping fields and the audit-logs
	 * collection in the schema (useful for maintaining consistent DB migrations).
	 */
	disabled?: boolean
	/**
	 * Enable debug mode. When `true` and `retention` is configured, the audit logs view
	 * shows buttons to immediately queue the archive and/or delete jobs without waiting for
	 * the cron schedule. Intended for development and testing only.
	 */
	debug?: boolean
	/**
	 * Automatic log retention and archiving via Payload Jobs Queue.
	 * When configured, registers two tasks: `audit-logs-archive` (if archive is set) and
	 * `audit-logs-delete`. Both tasks are scheduled via cron and run on the configured queue.
	 *
	 * You must configure a job runner (autoRun or bin script) for the same queue name -
	 * the plugin only registers the tasks, not the runner.
	 *
	 * @example
	 * retention: {
	 *   deleteAfter: 365,
	 *   archive: {
	 *     archiveAfter: 90,
	 *     uploadCollection: 'media',
	 *   },
	 * }
	 */
	retention?: DataRetentionConfig
	/**
	 * Globals to add audit fields and/or audit log to.
	 * Keys are global slugs; values are the audit configuration for that global.
	 */
	globals?: Partial<Record<GlobalSlug, GlobalAuditOptions>>
}
