import { type Config, definePlugin } from 'payload'

import { buildPluginContext } from './plugin/context'
import { registerCollections } from './plugin/registerCollections'
import { registerGlobals } from './plugin/registerGlobals'
import { registerLogsCollection } from './plugin/registerLogsCollection'
import { registerRetention } from './plugin/registerRetention'
import { registerTranslations } from './plugin/registerTranslations'
import { registerViews } from './plugin/registerViews'
import type { TranslationsOption } from './translations'
import type { AuditPluginConfig } from './types'

/**
 * Plugin options: the audit configuration itself plus `translations` for per-locale
 * string overrides.
 *
 * `disabled` comes from {@link AuditPluginConfig} and is deliberately weaker than the
 * repo-wide convention of returning `config` untouched: it stops every hook and job but
 * keeps the `audit-logs` collection and the audit fields in the schema, so a deployment
 * can turn auditing off without the next migration dropping columns.
 */
export type AuditLogsPluginOptions = AuditPluginConfig & {
	translations?: TranslationsOption
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/audit-logs': AuditLogsPluginOptions
	}
}

/**
 * Audit logging for Payload v3: who changed what, a diff per change, auth events,
 * and a browsable view. Authored with `definePlugin` so sibling plugins can detect
 * it by slug.
 */
export const auditLogs = definePlugin<AuditLogsPluginOptions>({
	slug: '@10x-media/audit-logs',
	plugin: ({ config, plugins: _plugins, ...pluginOptions }): Config => {
		const ctx = buildPluginContext(config, pluginOptions)

		registerTranslations(config, pluginOptions.translations)
		registerLogsCollection(config, ctx, pluginOptions)
		registerViews(config, ctx, pluginOptions)
		registerCollections(config, ctx, pluginOptions)
		registerGlobals(config, ctx, pluginOptions)
		registerRetention(config, pluginOptions)

		return config
	},
})

export { auditRelationshipField, createdByField, lastModifiedByField } from './fields/index'
export type {
	AnonymizeFunction,
	AuditFieldOptions,
	AuditFieldsCreateOptions,
	AuditOptions,
	AuditPluginConfig,
	CollectionAuditLogConfig,
	DataRetentionConfig,
	GlobalAuditLogConfig,
	GlobalAuditOptions,
	MultiTenancyConfig,
	OverrideFunction,
	ShouldLogFunction,
	ViewAccess,
} from './types'
export { REDACTED } from './types'
export type { CreateAuditEventOptions } from './utilities/createAuditEvent'
export { createAuditEvent } from './utilities/createAuditEvent'
export type { DiffEntry, DiffPaths, DiffPathValue } from './utilities/diffTypes'
export { typedDiff, typedSnapshot } from './utilities/diffTypes'

export type { AuditLogsPluginOptions as PluginOptions }
