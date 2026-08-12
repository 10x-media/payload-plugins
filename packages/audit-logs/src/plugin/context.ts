import type { CollectionSlug, Config } from 'payload'

import type { AuditPluginConfig, DataRetentionConfig, MultiTenancyConfig } from '../types'

/**
 * Everything derived once from the plugin options and the incoming config, then
 * threaded through every registration step. Nothing here depends on a single
 * collection or global.
 */
export type PluginContext = {
	collectIpAddress: boolean
	collectUserAgent: boolean
	/** What the `user` field on an audit log entry relates to. */
	defaultRelationTo: CollectionSlug | CollectionSlug[]
	/** Key read off `req.context` to group entries written by one operation. */
	groupContextKey: string | undefined
	groupEnabled: boolean
	/**
	 * Whether entries may be written straight to the database. Set by
	 * `registerLogsCollection`, because it depends on what `logs.override` returned.
	 */
	fastWrite: boolean
	/** True when more than one auth collection exists, so `user` stores `{ relationTo, value }`. */
	isUserPolymorphic: boolean
	multiTenancy: MultiTenancyConfig | undefined
	retention: DataRetentionConfig | undefined
	tenantFieldName: string | undefined
	tenantsSlug: string | undefined
}

export const buildPluginContext = (
	config: Config,
	pluginOptions: AuditPluginConfig
): PluginContext => {
	const authCollectionsSlugs = (config.collections ?? [])
		.filter((collection) => collection.auth)
		.map((collection) => collection.slug as CollectionSlug)

	// One auth collection stores a plain id, several store a polymorphic pair, none
	// falls back to the conventional slug. Read out rather than indexed: a length
	// check does not tell the compiler the element exists.
	const [onlyAuthCollection] = authCollectionsSlugs
	const defaultRelationTo: CollectionSlug | CollectionSlug[] =
		authCollectionsSlugs.length === 1 && onlyAuthCollection
			? onlyAuthCollection
			: authCollectionsSlugs.length > 1
				? authCollectionsSlugs
				: 'users'

	const groupConfig = pluginOptions.logs?.group
	const groupEnabled = Boolean(groupConfig)

	const multiTenancy = pluginOptions.multiTenancy === true ? {} : pluginOptions.multiTenancy

	return {
		collectIpAddress: pluginOptions.logs?.ipAddress !== false,
		// Corrected once the log collection is built and any override has run.
		fastWrite: true,
		collectUserAgent: pluginOptions.logs?.userAgent !== false,
		defaultRelationTo,
		groupContextKey: groupEnabled
			? (groupConfig !== true && groupConfig !== false && groupConfig?.contextKey) || 'auditGroup'
			: undefined,
		groupEnabled,
		isUserPolymorphic: Array.isArray(defaultRelationTo),
		multiTenancy,
		retention: pluginOptions.retention,
		tenantFieldName: multiTenancy?.tenantFieldName ?? (multiTenancy ? 'tenant' : undefined),
		tenantsSlug: multiTenancy?.tenantsSlug ?? (multiTenancy ? 'tenants' : undefined),
	}
}
