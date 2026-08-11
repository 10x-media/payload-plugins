import type { CollectionSlug } from 'payload'

import type {
	AuditFieldDefaultOptions,
	AuditFieldOptions,
	AuditOptions,
	CollectionAuditLogConfig,
	GlobalAuditOptions,
	ShouldLogFunction,
} from '../types'

export const DEFAULT_AUDIT_LOG_OPERATIONS: Array<'create' | 'delete' | 'update'> = [
	'create',
	'update',
	'delete',
]

/**
 * A single-entry `relationTo` array still stores a plain id, so only two or more
 * collections make the `user` field polymorphic.
 */
export const isPolymorphicRelationTo = (relationTo: CollectionSlug | CollectionSlug[]): boolean =>
	Array.isArray(relationTo) && relationTo.length > 1

export const resolveFieldOptions = (
	auditOptions: AuditOptions | GlobalAuditOptions,
	field: 'createdBy' | 'lastModifiedBy'
): AuditFieldOptions => {
	if (auditOptions === true) return {}
	const { auditFields } = auditOptions
	if (!auditFields) return false
	if (auditFields === true) return {}
	return auditFields[field] ?? false
}

/** Manual fields declare their own dot path; automatic ones are addressed by field name. */
export const resolveHookPath = (
	options: Exclude<AuditFieldOptions, false>,
	defaultFieldName: string
): string => {
	if (options.isManual) {
		return options.path
	}
	return options.name ?? defaultFieldName
}

export const mergeWithDefaults = (
	options: AuditFieldOptions,
	defaults: AuditFieldDefaultOptions | undefined
): AuditFieldOptions => {
	if (options === false || options.isManual || !defaults) {
		return options
	}
	return { ...defaults, ...options }
}

export type ResolvedGlobalAuditLogConfig = {
	drafts?: 'ignore' | 'log'
	excludeFields?: string[]
	shouldLog?: ShouldLogFunction
}

/** Globals are update-only, so they carry no `operations` or snapshot flags. */
export const resolveGlobalAuditLogConfig = (
	auditOptions: GlobalAuditOptions
): ResolvedGlobalAuditLogConfig | false => {
	if (auditOptions === true) return {}
	const { auditLog } = auditOptions
	if (!auditLog) return false
	if (auditLog === true) return {}
	return {
		drafts: auditLog.drafts,
		excludeFields: auditLog.excludeFields,
		shouldLog: auditLog.shouldLog,
	}
}

export type ResolvedAuditLogConfig = {
	drafts?: 'ignore' | 'log'
	excludeFields?: string[]
	operations: Array<'create' | 'delete' | 'update'>
	shouldLog?: ShouldLogFunction
	snapshotOnCreate: boolean
	snapshotOnDelete: boolean
}

export const resolveAuditLogConfig = (
	auditOptions: AuditOptions
): ResolvedAuditLogConfig | false => {
	if (auditOptions === true) {
		return {
			operations: DEFAULT_AUDIT_LOG_OPERATIONS,
			snapshotOnCreate: false,
			snapshotOnDelete: false,
		}
	}
	const { auditLog } = auditOptions
	if (!auditLog) return false
	const config: CollectionAuditLogConfig = auditLog === true ? {} : auditLog
	return {
		drafts: config.drafts,
		excludeFields: config.excludeFields,
		operations: config.operations ?? DEFAULT_AUDIT_LOG_OPERATIONS,
		shouldLog: config.shouldLog,
		snapshotOnCreate: config.snapshotOnCreate ?? false,
		snapshotOnDelete: config.snapshotOnDelete ?? false,
	}
}

/**
 * Login and password-reset logging is opt-in per collection, exactly like every other
 * option: `true` enables both events, an object picks between them, anything else is off.
 */
export const resolveAuthConfig = (
	auditOptions: AuditOptions | undefined
): { forgotPassword: boolean; login: boolean } | false => {
	if (auditOptions === undefined) return false
	if (auditOptions === true) return { forgotPassword: true, login: true }

	const { auth } = auditOptions
	if (!auth) return false
	if (auth === true) return { forgotPassword: true, login: true }
	return {
		forgotPassword: auth.forgotPassword ?? true,
		login: auth.login ?? true,
	}
}
