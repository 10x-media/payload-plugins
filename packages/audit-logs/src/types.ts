import type { Access, CollectionConfig, CollectionSlug, GlobalSlug, PayloadRequest, RelationshipField, Where } from 'payload'

type JobBase = { id: number | string }

export type ArchiveJobHooks = {
  /** Called once before the archive job begins processing. */
  beforeRun?: (args: { req: PayloadRequest; job: JobBase }) => Promise<void> | void
  /**
   * Called after each page of logs is written to the CSV stream.
   * Use this for heartbeats, progress tracking, or per-batch logging.
   *
   * @example — heartbeat
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
   * @example '0 3 1 * *'  — first day of each month at 3 AM
   * @example '0 3 * * 0'  — every Sunday at 3 AM
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
     * @example '0 2 * * 0'   — every Sunday at 2 AM
     * @example '0 2 1,15 * *' — twice a month (1st and 15th) at 2 AM
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
     *   alt: `Audit archive – ${filename}`,
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
     * by the plugin — do not include it in the return value.
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
 * Unlike Payload's `Access` type, this cannot return a Where query — only boolean.
 * Only `req` is available (no collection/id/data context).
 */
export type ViewAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

// ---------- Audit Log types ----------

/**
 * Sentinel value returned from an AnonymizeFunction to indicate the field value should not be
 * written to the diff. The change is still recorded in changedPaths.
 */
export const REDACTED = '__REDACTED__' as const
export type RedactedValue = typeof REDACTED

export type AnonymizeFunction = (args: {
  collection: CollectionSlug
  documentId: number | string
  operation: 'create' | 'delete' | 'update'
  path: string
  redacted: RedactedValue
  value: unknown
}) => unknown

/**
 * Per-event decision function. Return `false` to skip writing the audit log entry.
 * Called after the diff is computed — `changedPaths` is always available for `update`,
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
   *  Always `{}` for `create` and `delete` — only meaningful for `update`. */
  diff: Record<string, { before: unknown; after: unknown }>
  changedPaths: string[]
}) => boolean | Promise<boolean>

/**
 * Audit log configuration for globals. Only `drafts`, `excludeFields`, and `shouldLog`
 * are applicable — globals are always `update`-only and never have create/delete snapshots.
 */
export type GlobalAuditLogConfig = Pick<CollectionAuditLogConfig, 'drafts' | 'excludeFields' | 'shouldLog'>

export type CollectionAuditLogConfig = {
  /**
   * Controls how draft saves are handled when the collection has `versions.drafts` enabled.
   *
   * - `'log'` — log every save, including autosave drafts (default)
   * - `'ignore'` — skip draft saves entirely (but always log `create`); on publish, diff is
   *   computed against the last published version (via `findVersions`) rather than the last draft
   *
   * Can also be set as a top-level plugin default via `AuditPluginConfig.drafts`.
   * Per-collection value takes precedence.
   *
   * @default 'log'
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
 * - `false` — disables the field entirely
 * - `AuditFieldAutomaticOptions` — plugin creates and manages the field automatically
 * - `AuditFieldManualOptions` — field is defined manually; plugin only writes to it via hooks
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
 * - `true` — enable both `auditFields` and `auditLog` with defaults
 * - object — opt-in: only what is explicitly set is enabled
 */
export type AuditOptions =
  | true
  | {
      /**
       * Configuration for the `createdBy` and `lastModifiedBy` fields.
       * - `true` — enable both fields with defaults
       * - `false` — disable both fields (same as omitting)
       * - object — granular control over each field; omitted fields are disabled
       */
      auditFields?: AuditFieldsOptions
      /**
       * Configuration for CRUD audit log entries.
       * - `true` — enable with all operations and defaults
       * - `false` — disable (same as omitting)
       * - object — granular control
       */
      auditLog?: true | false | CollectionAuditLogConfig
    }

/**
 * Per-global audit configuration.
 *
 * - `true` — enable both `auditFields` and `auditLog` with defaults
 * - object — opt-in: only what is explicitly set is enabled
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
   * Collections to exclude from tenant capture.
   * Useful when a collection has a field named after `tenantFieldName` for unrelated reasons —
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
   * - `'log'` — log every save, including autosave drafts (default)
   * - `'ignore'` — skip draft saves; on publish, diff is computed against the last published version
   *
   * @default 'log'
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
   * Auth event logging for all auth-enabled collections.
   *
   * - omitted / not set — all auth events logged for all auth collections (default)
   * - `false` — disable all auth event logging globally
   * - object — per-collection control; unspecified collections use the default (all on)
   *
   * @example
   * auth: false  // disable globally
   *
   * @example
   * auth: {
   *   users: false,                                  // disable for users entirely
   *   admins: { login: true, forgotPassword: false }, // only log logins for admins
   * }
   */
  auth?:
    | false
    | Partial<
        Record<
          CollectionSlug,
          | false
          | {
              forgotPassword?: boolean
              login?: boolean
            }
        >
      >
  /**
   * Configuration for the audit-logs collection itself.
   */
  logs?: {
    /**
     * Override the generated `audit-logs` collection config.
     * Receives the fully built collection and should return the modified version.
     * The `slug` is always forced back to `'audit-logs'` — everything else is up to you.
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
     * - `true` — enable with the default context key `'auditGroup'`
     * - `{ contextKey }` — use a custom key on `req.context`
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
           * Returns boolean only — cannot return a Where query.
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
           * Use this to scope the built-in view to a subset of logs — for example, to a specific
           * collection, tenant, or event type. For fully custom views, pass `forceWhere` directly
           * as a `serverProps` entry when registering the view component.
           *
           * @example
           * // Only show logs for the 'orders' collection
           * forceWhere: { relationTo: { equals: 'orders' } }
           */
          forceWhere?: Where
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
   * - `true` — enable with all defaults (`tenantsSlug: 'tenants'`, `tenantFieldName: 'tenant'`)
   * - object — explicit configuration
   *
   * When configured, the plugin reads the tenant from each audited document and stores it
   * on the audit log entry. A tenant-scoped view is also registered (unless disabled).
   */
  multiTenancy?: true | MultiTenancyConfig
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
   * You must configure a job runner (autoRun or bin script) for the same queue name —
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
