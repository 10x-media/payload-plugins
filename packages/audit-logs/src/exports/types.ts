/**
 * The plugin's public type surface, reachable as `@10x-media/audit-logs/types`.
 *
 * Listed one by one rather than re-exported wholesale, so what a consumer can rely
 * on is visible here and widening it stays a deliberate edit. Everything below is
 * something a host writes by hand: a shape in the options object, or the signature
 * of a callback it hands to the plugin.
 *
 * `REDACTED` is a value rather than a type and cannot travel through this entry
 * point; it is exported from the package root for `value === REDACTED` checks.
 */

/** Root options object, the argument to `auditLogs()`. */
export type { AuditPluginConfig } from '../types'

/** Options as accepted for one collection or one global. */
export type {
	AuditOptions,
	CollectionAuditLogConfig,
	GlobalAuditLogConfig,
	GlobalAuditOptions,
} from '../types'

/** Shape of the `createdBy` and `lastModifiedBy` fields the plugin injects. */
export type {
	AuditFieldDefaultOptions,
	AuditFieldOptions,
	AuditFieldsCreateOptions,
} from '../types'

/** Callbacks the host implements. */
export type {
	AnonymizeFunction,
	OverrideFunction,
	ShouldLogFunction,
	ViewAccess,
} from '../types'

/** Hooks into the archive and delete jobs. */
export type { ArchiveJobHooks, DeleteJobHooks } from '../types'

/** Retention, multi tenancy, and the marker `anonymize` returns. */
export type { DataRetentionConfig, MultiTenancyConfig, RedactedValue } from '../types'

/** Plugin options as the monorepo names them, kept alongside the audit specific ones. */
export type { AuditLogsPluginOptions, PluginOptions } from '../index'
