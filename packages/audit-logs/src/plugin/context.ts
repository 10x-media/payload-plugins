import type { Config } from 'payload'

import type { AuditPluginConfig, DataRetentionConfig, MultiTenancyConfig } from '../types'

/**
 * Everything derived once from the plugin options and the incoming config, then
 * threaded through every registration step. Nothing here depends on a single
 * collection or global.
 */
export type PluginContext = {
	collectIpAddress: boolean
	collectUserAgent: boolean
	/** Key read off `req.context` to group entries written by one operation. */
	groupContextKey: string | undefined
	groupEnabled: boolean
	/**
	 * Whether entries may be written straight to the database. Set by
	 * `registerLogsCollection`, because it depends on what `logs.override` returned.
	 */
	fastWrite: boolean
	multiTenancy: MultiTenancyConfig | undefined
	/** Whether entries carry an `impersonator` field. See `AuditPluginConfig.impersonation`. */
	recordImpersonator: boolean
	retention: DataRetentionConfig | undefined
	tenantFieldName: string | undefined
	tenantsSlug: string | undefined
}

export const buildPluginContext = (
	config: Config,
	pluginOptions: AuditPluginConfig,
	/** The `definePlugin` slug map, built from every entry of `config.plugins`. */
	plugins: Record<string, unknown> = {}
): PluginContext => {
	const groupConfig = pluginOptions.logs?.group
	const groupEnabled = Boolean(groupConfig)

	const multiTenancy = pluginOptions.multiTenancy === true ? {} : pluginOptions.multiTenancy

	return {
		collectIpAddress: pluginOptions.logs?.ipAddress !== false,
		// Corrected once the log collection is built and any override has run.
		fastWrite: true,
		collectUserAgent: pluginOptions.logs?.userAgent !== false,
		groupContextKey: groupEnabled
			? (groupConfig !== true && groupConfig !== false && groupConfig?.contextKey) || 'auditGroup'
			: undefined,
		groupEnabled,
		multiTenancy,
		recordImpersonator: pluginOptions.impersonation ?? Boolean(plugins['@10x-media/impersonation']),
		retention: pluginOptions.retention,
		tenantFieldName: multiTenancy?.tenantFieldName ?? (multiTenancy ? 'tenant' : undefined),
		tenantsSlug: multiTenancy?.tenantsSlug ?? (multiTenancy ? 'tenants' : undefined),
	}
}
