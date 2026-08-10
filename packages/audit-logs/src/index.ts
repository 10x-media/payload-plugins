import {
	type CollectionSlug,
	type Config,
	definePlugin,
	type Field,
	type GlobalSlug,
	type TaskConfig,
} from 'payload'

import { registerTranslations } from './plugin/registerTranslations'
import type { TranslationsOption } from './translations'

import type {
	AnonymizeFunction,
	AuditFieldDefaultOptions,
	AuditFieldOptions,
	AuditOptions,
	AuditPluginConfig,
	CollectionAuditLogConfig,
	GlobalAuditOptions,
	ShouldLogFunction,
} from './types'

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

import { buildAuditLogsCollection } from './collections/AuditLogs'
import { createdByField, lastModifiedByField } from './fields/index'
import { afterForgotPasswordAuditLog, afterLoginAuditLog } from './hooks/afterAuthCollection'
import { afterChangeCollectionAuditLog } from './hooks/afterChangeCollection'
import { afterChangeGlobalAuditLog } from './hooks/afterChangeGlobal'
import { afterDeleteCollectionAuditLog } from './hooks/afterDeleteCollection'
import {
	type AuditHookFieldConfig,
	beforeChangeCollectionAuditField,
} from './hooks/beforeChangeCollection'
import { beforeChangeGlobalAuditField } from './hooks/beforeChangeGlobal'
import { buildArchiveTask } from './jobs/archiveAuditLogs'
import { buildDeleteTask } from './jobs/deleteAuditLogs'
import { buildFieldMap } from './utilities/buildFieldMap'

type AuditHookConfig = {
	createdByHookConfig: AuditHookFieldConfig | false
	fields: Field[]
	hasActiveFields: boolean
	lastModifiedByHookConfig: AuditHookFieldConfig | false
}

const DEFAULT_AUDIT_LOG_OPERATIONS: Array<'create' | 'delete' | 'update'> = [
	'create',
	'update',
	'delete',
]

const isPolymorphicRelationTo = (relationTo: CollectionSlug | CollectionSlug[]): boolean =>
	Array.isArray(relationTo) && relationTo.length > 1

const resolveFieldOptions = (
	auditOptions: AuditOptions | GlobalAuditOptions,
	field: 'createdBy' | 'lastModifiedBy'
): AuditFieldOptions => {
	if (auditOptions === true) return {}
	const { auditFields } = auditOptions
	if (!auditFields) return false
	if (auditFields === true) return {}
	return auditFields[field] ?? false
}

const resolveHookPath = (
	options: Exclude<AuditFieldOptions, false>,
	defaultFieldName: string
): string => {
	if (options.isManual) {
		return options.path
	}
	return options.name ?? defaultFieldName
}

const mergeWithDefaults = (
	options: AuditFieldOptions,
	defaults: AuditFieldDefaultOptions | undefined
): AuditFieldOptions => {
	if (options === false || options.isManual || !defaults) {
		return options
	}
	return { ...defaults, ...options }
}

const resolveGlobalAuditLogConfig = (
	auditOptions: GlobalAuditOptions
):
	| { drafts?: 'ignore' | 'log'; excludeFields?: string[]; shouldLog?: ShouldLogFunction }
	| false => {
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

const resolveAuditLogConfig = (
	auditOptions: AuditOptions
):
	| {
			drafts?: 'ignore' | 'log'
			excludeFields?: string[]
			operations: Array<'create' | 'delete' | 'update'>
			shouldLog?: ShouldLogFunction
			snapshotOnCreate: boolean
			snapshotOnDelete: boolean
	  }
	| false => {
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

const resolveAuthConfig = (
	pluginAuth: AuditPluginConfig['auth'],
	collectionSlug: CollectionSlug
): { forgotPassword: boolean; login: boolean } | false => {
	if (pluginAuth === false) return false
	if (!pluginAuth) return { forgotPassword: true, login: true }
	const collectionAuth = pluginAuth[collectionSlug]
	if (collectionAuth === false) return false
	return {
		forgotPassword: collectionAuth?.forgotPassword ?? true,
		login: collectionAuth?.login ?? true,
	}
}

// biome-ignore lint/complexity/useMaxParams: field list, per-entity options, relationTo and plugin defaults are independent inputs
const buildAuditConfig = (
	existingFields: Field[],
	auditOptions: AuditOptions | GlobalAuditOptions,
	defaultRelationTo: CollectionSlug | CollectionSlug[],
	pluginDefaults: AuditPluginConfig['defaults']
): AuditHookConfig => {
	const fields = [...existingFields]

	const createdByOptions = mergeWithDefaults(
		resolveFieldOptions(auditOptions, 'createdBy'),
		pluginDefaults?.createdBy
	)
	const lastModifiedByOptions = mergeWithDefaults(
		resolveFieldOptions(auditOptions, 'lastModifiedBy'),
		pluginDefaults?.lastModifiedBy
	)

	if (createdByOptions !== false && !createdByOptions.isManual) {
		fields.push(
			createdByField(
				{ relationTo: defaultRelationTo, ...createdByOptions },
				createdByOptions.overrides
			)
		)
	}

	if (lastModifiedByOptions !== false && !lastModifiedByOptions.isManual) {
		fields.push(
			lastModifiedByField(
				{ relationTo: defaultRelationTo, ...lastModifiedByOptions },
				lastModifiedByOptions.overrides
			)
		)
	}

	const resolvedCreatedByRelationTo =
		createdByOptions !== false
			? (createdByOptions.relationTo ?? defaultRelationTo)
			: defaultRelationTo

	const resolvedLastModifiedByRelationTo =
		lastModifiedByOptions !== false
			? (lastModifiedByOptions.relationTo ?? defaultRelationTo)
			: defaultRelationTo

	const createdByHookConfig: AuditHookFieldConfig | false =
		createdByOptions !== false
			? {
					isPolymorphic: createdByOptions.isManual
						? (createdByOptions.isPolymorphic ?? false)
						: isPolymorphicRelationTo(resolvedCreatedByRelationTo),
					path: resolveHookPath(createdByOptions, 'createdBy'),
					relationTo: resolvedCreatedByRelationTo,
				}
			: false

	const lastModifiedByHookConfig: AuditHookFieldConfig | false =
		lastModifiedByOptions !== false
			? {
					isPolymorphic: lastModifiedByOptions.isManual
						? (lastModifiedByOptions.isPolymorphic ?? false)
						: isPolymorphicRelationTo(resolvedLastModifiedByRelationTo),
					path: resolveHookPath(lastModifiedByOptions, 'lastModifiedBy'),
					relationTo: resolvedLastModifiedByRelationTo,
				}
			: false

	return {
		createdByHookConfig,
		fields,
		hasActiveFields: createdByHookConfig !== false || lastModifiedByHookConfig !== false,
		lastModifiedByHookConfig,
	}
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
		// No early return on `disabled`: the collection and the audit fields are still added
		// below so the schema stays stable. Behaviour is switched off at each hook site.
		registerTranslations(config, pluginOptions.translations)

		if (!config.collections) {
			config.collections = []
		}

		const authCollectionsSlugs = config.collections
			.filter((collection) => collection.auth)
			.map((collection) => collection.slug)

		// Single auth collection → string (non-polymorphic, stores as plain ID)
		// Multiple → array (polymorphic, stores as { relationTo, value })
		// None → fallback to 'users'
		// Read out rather than indexed, so the single collection case narrows to a slug instead
		// of `string | undefined`: a length check does not tell the compiler the element exists.
		const [onlyAuthCollection] = authCollectionsSlugs
		const defaultRelationTo: CollectionSlug | CollectionSlug[] =
			authCollectionsSlugs.length === 1 && onlyAuthCollection
				? onlyAuthCollection
				: authCollectionsSlugs.length > 1
					? authCollectionsSlugs
					: 'users'

		const isUserPolymorphic = Array.isArray(defaultRelationTo)

		const collectIpAddress = pluginOptions.logs?.ipAddress !== false
		const collectUserAgent = pluginOptions.logs?.userAgent !== false
		const groupConfig = pluginOptions.logs?.group
		const groupEnabled = Boolean(groupConfig)
		const groupContextKey = groupEnabled
			? (groupConfig !== true && groupConfig !== false && groupConfig?.contextKey) || 'auditGroup'
			: undefined

		const retention = pluginOptions.retention

		const multiTenancy = pluginOptions.multiTenancy === true ? {} : pluginOptions.multiTenancy
		const tenantsSlug = multiTenancy?.tenantsSlug ?? (multiTenancy ? 'tenants' : undefined)
		const tenantFieldName = multiTenancy?.tenantFieldName ?? (multiTenancy ? 'tenant' : undefined)

		// Add audit-logs collection — always included for schema consistency even when disabled
		const builtAuditLogsCollection = buildAuditLogsCollection(
			pluginOptions.logs?.hidden !== false,
			defaultRelationTo,
			pluginOptions.logs?.access,
			tenantsSlug,
			Boolean(retention?.archive),
			groupEnabled
		)
		const auditLogsCollection = pluginOptions.logs?.override
			? { ...pluginOptions.logs.override(builtAuditLogsCollection), slug: 'audit-logs' as const }
			: builtAuditLogsCollection
		config.collections.push(auditLogsCollection)

		// Register audit logs viewer unless explicitly disabled
		const viewConfig = pluginOptions.logs?.view
		if (viewConfig !== false) {
			const viewPath = viewConfig?.path ?? '/audit-logs'
			config.admin = {
				...config.admin,
				components: {
					...config.admin?.components,
					views: {
						...config.admin?.components?.views,
						auditLogs: {
							Component: {
								path: '@10x-media/audit-logs/rsc#AuditLogsView',
								serverProps: {
									pluginOptions,
									...(viewConfig?.forceWhere ? { forceWhere: viewConfig.forceWhere } : {}),
								},
							},
							path: viewPath,
						},
					},
				},
			}
		}

		// Register tenant-scoped audit logs view when multiTenancy is configured
		const tenantViewConfig = multiTenancy?.tenantView
		if (multiTenancy && tenantViewConfig !== false) {
			const tenantViewPath =
				tenantViewConfig != null && tenantViewConfig !== true && tenantViewConfig.path
					? tenantViewConfig.path
					: '/audit-logs-tenant'
			config.admin = {
				...config.admin,
				components: {
					...config.admin?.components,
					views: {
						...config.admin?.components?.views,
						auditLogsTenant: {
							Component: {
								path: '@10x-media/audit-logs/rsc#AuditLogsView',
								serverProps: {
									pluginOptions,
									useTenant: true,
								},
							},
							path: tenantViewPath,
						},
					},
				},
			}
		}

		config.collections = config.collections.map((collection) => {
			const collectionOptions = pluginOptions.collections?.[collection.slug]

			// Collections not in plugin config: only wire auth hooks if auth-enabled
			if (!collectionOptions) {
				if (!pluginOptions.disabled && collection.auth) {
					const authConfig = resolveAuthConfig(
						pluginOptions.auth,
						collection.slug as CollectionSlug
					)
					if (authConfig !== false) {
						const authOptions = {
							collectionSlug: collection.slug,
							collectIpAddress,
							collectUserAgent,
							groupContextKey,
							isUserPolymorphic,
						}
						const hooks = { ...collection.hooks }
						if (authConfig.login) {
							hooks.afterLogin = [...(hooks.afterLogin ?? []), afterLoginAuditLog(authOptions)]
						}
						if (authConfig.forgotPassword) {
							hooks.afterForgotPassword = [
								...(hooks.afterForgotPassword ?? []),
								afterForgotPasswordAuditLog(authOptions),
							]
						}
						return { ...collection, hooks }
					}
				}
				return collection
			}

			const { createdByHookConfig, fields, hasActiveFields, lastModifiedByHookConfig } =
				buildAuditConfig(
					collection.fields,
					collectionOptions,
					defaultRelationTo,
					pluginOptions.defaults
				)

			const auditLogConfig = resolveAuditLogConfig(collectionOptions)

			const hooks = { ...collection.hooks }

			if (!pluginOptions.disabled && hasActiveFields) {
				hooks.beforeChange = [
					beforeChangeCollectionAuditField({
						createdBy: createdByHookConfig,
						lastModifiedBy: lastModifiedByHookConfig,
					}),
					...(hooks.beforeChange ?? []),
				]
			}

			if (!pluginOptions.disabled && auditLogConfig !== false) {
				const anonymize = pluginOptions.anonymize?.[collection.slug]
				const isSelfTenant = Boolean(multiTenancy && tenantsSlug && collection.slug === tenantsSlug)
				const collectionTenantFieldName =
					!isSelfTenant &&
					tenantFieldName &&
					!multiTenancy?.excludeCollections?.includes(collection.slug as CollectionSlug)
						? tenantFieldName
						: undefined
				const fieldMap =
					pluginOptions.normalizeRelationships !== false ? buildFieldMap(fields) : undefined

				hooks.afterChange = [
					...(hooks.afterChange ?? []),
					afterChangeCollectionAuditLog({
						anonymize,
						collectionSlug: collection.slug,
						collectIpAddress,
						collectUserAgent,
						drafts: auditLogConfig.drafts ?? pluginOptions.drafts ?? 'log',
						excludeFields: [
							...(collection.auth ? ['hash', 'salt'] : []),
							...(auditLogConfig.excludeFields ?? []),
						],
						fieldMap,
						groupContextKey,
						isUserPolymorphic,
						isSelfTenant,
						operations: auditLogConfig.operations,
						shouldLog: auditLogConfig.shouldLog,
						snapshotOnCreate: auditLogConfig.snapshotOnCreate,
						tenantFieldName: collectionTenantFieldName,
					}),
				]
				// afterChange filters on `operations` inside the hook; afterDelete has no such
				// check, so the option has to be honoured at registration time.
				if (auditLogConfig.operations.includes('delete')) {
					hooks.afterDelete = [
						...(hooks.afterDelete ?? []),
						afterDeleteCollectionAuditLog({
							anonymize,
							collectionSlug: collection.slug,
							collectIpAddress,
							collectUserAgent,
							fieldMap,
							groupContextKey,
							isUserPolymorphic,
							isSelfTenant,
							shouldLog: auditLogConfig.shouldLog,
							snapshotOnDelete: auditLogConfig.snapshotOnDelete,
							tenantFieldName: collectionTenantFieldName,
						}),
					]
				}
			}

			// Auth hooks — independent from auditLog, only for auth-enabled collections
			if (!pluginOptions.disabled && collection.auth) {
				const authConfig = resolveAuthConfig(pluginOptions.auth, collection.slug as CollectionSlug)
				if (authConfig !== false) {
					const authOptions = {
						collectionSlug: collection.slug,
						collectIpAddress,
						collectUserAgent,
						groupContextKey,
						isUserPolymorphic,
					}
					if (authConfig.login) {
						hooks.afterLogin = [...(hooks.afterLogin ?? []), afterLoginAuditLog(authOptions)]
					}
					if (authConfig.forgotPassword) {
						hooks.afterForgotPassword = [
							...(hooks.afterForgotPassword ?? []),
							afterForgotPasswordAuditLog(authOptions),
						]
					}
				}
			}

			return { ...collection, fields, hooks }
		})

		if (config.globals) {
			config.globals = config.globals.map((global) => {
				const globalOptions = pluginOptions.globals?.[global.slug]
				if (!globalOptions) {
					return global
				}

				const { createdByHookConfig, fields, hasActiveFields, lastModifiedByHookConfig } =
					buildAuditConfig(global.fields, globalOptions, defaultRelationTo, pluginOptions.defaults)

				const auditLogConfig = resolveGlobalAuditLogConfig(globalOptions)

				const hooks = { ...global.hooks }

				if (!pluginOptions.disabled && hasActiveFields) {
					hooks.beforeChange = [
						beforeChangeGlobalAuditField({
							createdBy: createdByHookConfig,
							lastModifiedBy: lastModifiedByHookConfig,
						}),
						...(hooks.beforeChange ?? []),
					]
				}

				if (!pluginOptions.disabled && auditLogConfig !== false) {
					const globalTenantFieldName =
						tenantFieldName && !multiTenancy?.excludeGlobals?.includes(global.slug as GlobalSlug)
							? tenantFieldName
							: undefined
					const fieldMap =
						pluginOptions.normalizeRelationships !== false ? buildFieldMap(fields) : undefined

					hooks.afterChange = [
						...(hooks.afterChange ?? []),
						afterChangeGlobalAuditLog({
							anonymize:
								pluginOptions.anonymize?.[global.slug as keyof typeof pluginOptions.anonymize],
							collectIpAddress,
							collectUserAgent,
							drafts: auditLogConfig.drafts ?? pluginOptions.drafts ?? 'log',
							excludeFields: auditLogConfig.excludeFields,
							fieldMap,
							globalSlug: global.slug,
							groupContextKey,
							isUserPolymorphic,
							shouldLog: auditLogConfig.shouldLog,
							tenantFieldName: globalTenantFieldName,
						}),
					]
				}

				return { ...global, fields, hooks }
			})
		}

		// Register debug endpoint for manually triggering retention jobs
		if (!pluginOptions.disabled && pluginOptions.debug && retention) {
			config.endpoints = [
				...(config.endpoints ?? []),
				{
					path: '/audit-retention/run',
					method: 'post',
					handler: async (req) => {
						if (!req.user) {
							return Response.json({ error: 'Unauthorized' }, { status: 401 })
						}
						const url = new URL(req.url ?? '', 'http://localhost')
						const task = url.searchParams.get('task')
						if (task !== 'audit-logs-archive' && task !== 'audit-logs-delete') {
							return Response.json({ error: 'Invalid task' }, { status: 400 })
						}
						if (task === 'audit-logs-archive' && !retention.archive) {
							return Response.json({ error: 'Archive not configured' }, { status: 400 })
						}
						await req.payload.jobs.queue({
							task: task as 'audit-logs-archive' | 'audit-logs-delete',
							input: undefined,
							queue: retention.queue ?? 'audit-retention',
						})
						return Response.json({ queued: true, task })
					},
				},
			]
		}

		// Register retention jobs if configured and plugin is not disabled
		if (!pluginOptions.disabled && retention) {
			const queue = retention.queue ?? 'audit-retention'
			const tasks: TaskConfig[] = []

			if (retention.archive) {
				tasks.push(
					buildArchiveTask({
						cron: retention.archive.cron,
						queue,
						uploadCollection: retention.archive.uploadCollection as string,
						where: retention.archive.where,
						anonymize: retention.archive.anonymize as Partial<Record<string, AnonymizeFunction>>,
						excludeFields: retention.archive.excludeFields ?? ['ipAddress', 'userAgent'],
						generateFilename: retention.archive.generateFilename,
						populateUploadFields: retention.archive.populateUploadFields,
						hooks: retention.archive.hooks,
					})
				)
			}

			tasks.push(
				buildDeleteTask({
					cron: retention.deleteCron,
					queue,
					hasArchive: Boolean(retention.archive),
					where: retention.deleteWhere,
					hooks: retention.deleteHooks,
				})
			)

			config.jobs = {
				...config.jobs,
				tasks: [...(config.jobs?.tasks ?? []), ...tasks],
			}
		}

		/**
		 * If the plugin is disabled, we still want to keep added collections/fields so the database
		 * schema is consistent which is important for migrations.
		 */
		if (pluginOptions.disabled) {
			return config
		}

		const incomingOnInit = config.onInit

		config.onInit = async (payload) => {
			if (incomingOnInit) {
				await incomingOnInit(payload)
			}
		}

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
