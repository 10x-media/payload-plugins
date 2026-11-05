import type { Config, GlobalConfig, GlobalSlug } from 'payload'

import { afterChangeGlobalAuditLog } from '../hooks/afterChangeGlobal'
import type { AuditPluginConfig } from '../types'
import { buildFieldMap } from '../utilities/buildFieldMap'
import type { PluginContext } from './context'
import { resolveGlobalAuditLogConfig } from './resolveOptions'

const registerGlobal = (
	global: GlobalConfig,
	ctx: PluginContext,
	pluginOptions: AuditPluginConfig
): GlobalConfig => {
	const slug = global.slug as GlobalSlug
	const globalOptions = pluginOptions.globals?.[slug]
	if (!globalOptions) return global

	const auditLogConfig = resolveGlobalAuditLogConfig(globalOptions)

	const hooks = { ...global.hooks }

	if (!pluginOptions.disabled && auditLogConfig !== false) {
		const tenantFieldName =
			ctx.tenantFieldName && !ctx.multiTenancy?.excludeGlobals?.includes(slug)
				? ctx.tenantFieldName
				: undefined
		const fieldMap =
			pluginOptions.normalizeRelationships !== false
				? buildFieldMap(global.fields, { blocks: ctx.configBlocks })
				: undefined

		hooks.afterChange = [
			...(hooks.afterChange ?? []),
			afterChangeGlobalAuditLog({
				anonymize: pluginOptions.anonymize?.[slug],
				collectIpAddress: ctx.collectIpAddress,
				fastWrite: ctx.fastWrite,
				collectUserAgent: ctx.collectUserAgent,
				drafts: auditLogConfig.drafts ?? pluginOptions.drafts ?? 'ignore',
				excludeFields: auditLogConfig.excludeFields,
				fieldMap,
				globalSlug: slug,
				groupContextKey: ctx.groupContextKey,
				recordImpersonator: ctx.recordImpersonator,
				shouldLog: auditLogConfig.shouldLog,
				tenantFieldName,
			}),
		]
	}

	return { ...global, hooks }
}

export const registerGlobals = (
	config: Config,
	ctx: PluginContext,
	pluginOptions: AuditPluginConfig
): void => {
	if (!config.globals) return
	config.globals = config.globals.map((global) => registerGlobal(global, ctx, pluginOptions))
}
