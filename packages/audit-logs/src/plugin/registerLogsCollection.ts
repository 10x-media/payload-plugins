import type { Config } from 'payload'

import { buildAuditLogsCollection } from '../collections/AuditLogs'
import type { AuditPluginConfig } from '../types'
import type { PluginContext } from './context'

/**
 * Adds the `audit-logs` collection. Registered even when the plugin is `disabled`, so
 * turning auditing off in one environment does not make the next migration drop the
 * table.
 */
export const registerLogsCollection = (
	config: Config,
	ctx: PluginContext,
	pluginOptions: AuditPluginConfig
): void => {
	const built = buildAuditLogsCollection(
		pluginOptions.logs?.hidden !== false,
		ctx.defaultRelationTo,
		pluginOptions.logs?.access,
		ctx.tenantsSlug,
		Boolean(ctx.retention?.archive),
		ctx.groupEnabled
	)

	// The slug is forced back: hooks, the view and the jobs all address it by name.
	config.collections = [
		...(config.collections ?? []),
		pluginOptions.logs?.override
			? { ...pluginOptions.logs.override(built), slug: 'audit-logs' as const }
			: built,
	]
}
