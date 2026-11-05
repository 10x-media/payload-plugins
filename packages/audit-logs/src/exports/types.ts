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

/** Plugin options as the monorepo names them, kept alongside the audit specific ones. */
export type { AuditLogsPluginOptions, PluginOptions } from '../index'
/** Root options object, the argument to `auditLogs()`. */
/** Options as accepted for one collection or one global. */
/** Where the plugin shows Payload's authorship fields, and its own field factory. */
/** Callbacks the host implements. */
/** Hooks into the archive and delete jobs. */
/** Retention, multi tenancy, and the marker `anonymize` returns. */
/** View slots, filters and the entry extension, with the props each receives. */
export type {
	AnonymizeFunction,
	ArchiveJobHooks,
	AuditLogRowState,
	AuditLogsListSlotProps,
	AuditLogsRowSlotProps,
	AuditLogsSlotServerProps,
	AuditLogsViewContext,
	AuditLogUser,
	AuditOptions,
	AuditPluginConfig,
	AuditRelationshipFieldOptions,
	AuthEventsOptions,
	AuthorshipFieldsOptions,
	CollectionAuditLogConfig,
	CustomEventComponentProps,
	CustomEventComponents,
	DataRetentionConfig,
	DeleteJobHooks,
	EventTypeOption,
	ExtendEntryFunction,
	FilterHrefFunction,
	GlobalAuditLogConfig,
	GlobalAuditOptions,
	LoadViewContextFunction,
	MultiTenancyConfig,
	PayloadAPIOption,
	PayloadAPIOptionObject,
	RedactedValue,
	RelationshipViewFilter,
	ShouldLogFunction,
	ViewAccess,
	ViewFilter,
} from '../types'
