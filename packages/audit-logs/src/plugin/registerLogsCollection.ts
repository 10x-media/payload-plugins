import type { CollectionConfig, Config } from 'payload'

import { buildAuditLogsCollection } from '../collections/AuditLogs'
import type { AuditPluginConfig } from '../types'
import type { PluginContext } from './context'

/**
 * What `createAuditEvent` needs from the plugin options at runtime, which it only reaches
 * through the finished config. Stored on the log collection as `custom.auditLogs`.
 */
export type AuditLogsCustom = {
	/** The key the CRUD hooks read the group from, when `logs.group` is on. */
	groupContextKey: string | undefined
}

/**
 * Adds the `audit-logs` collection. Registered even when the plugin is `disabled`, so
 * turning auditing off in one environment does not make the next migration drop the
 * table.
 *
 * The slug, the `@10x-media/content-lock` exemption and `custom.auditLogs` are applied
 * after `logs.override`, so an override can change none of them.
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
		ctx.groupEnabled,
		ctx.recordImpersonator
	)

	const overridden = pluginOptions.logs?.override ? pluginOptions.logs.override(built) : built
	const collection: CollectionConfig = {
		...overridden,
		// Hooks, the view and the jobs all address it by name.
		slug: 'audit-logs',
		// Bookkeeping, not content: an entry follows a write a lock already let through (a login,
		// an exempt collection), and rejecting the entry would fail that write too.
		custom: {
			...overridden.custom,
			contentLock: { exempt: true },
			auditLogs: { groupContextKey: ctx.groupContextKey } satisfies AuditLogsCustom,
		},
	}

	// Anything that is not a recognisable empty hook array counts as a hook, so an
	// unfamiliar shape falls back to the pipeline rather than silently skipping it.
	ctx.fastWrite = Object.values(collection.hooks ?? {}).every(
		(hooks) => Array.isArray(hooks) && hooks.length === 0
	)

	config.collections = [...(config.collections ?? []), collection]
}
