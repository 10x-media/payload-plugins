import type { Config } from 'payload'

import { buildAuditLogsCollection } from '../collections/AuditLogs'
import type { AuditPluginConfig } from '../types'
import type { PluginContext } from './context'

/**
 * Adds the `audit-logs` collection. Registered even when the plugin is `disabled`, so
 * turning auditing off in one environment does not make the next migration drop the
 * table.
 *
 * Also settles `ctx.fastWrite`. The plugin builds this collection without hooks, so any
 * the finished config carries came from `logs.override`, and a direct database write
 * would skip them. Must run before anything that writes entries.
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
	const collection = pluginOptions.logs?.override
		? { ...pluginOptions.logs.override(built), slug: 'audit-logs' as const }
		: built

	// Anything that is not a recognisable empty hook array counts as a hook, so an
	// unfamiliar shape falls back to the pipeline rather than silently skipping it.
	ctx.fastWrite = Object.values(collection.hooks ?? {}).every(
		(hooks) => Array.isArray(hooks) && hooks.length === 0
	)

	config.collections = [...(config.collections ?? []), collection]
}
