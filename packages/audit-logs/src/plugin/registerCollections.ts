import type { CollectionConfig, CollectionSlug, Config } from 'payload'

import { afterForgotPasswordAuditLog, afterLoginAuditLog } from '../hooks/afterAuthCollection'
import { afterChangeCollectionAuditLog } from '../hooks/afterChangeCollection'
import { afterDeleteCollectionAuditLog } from '../hooks/afterDeleteCollection'
import { beforeChangeCollectionAuditField } from '../hooks/beforeChangeCollection'
import type { AuditOptions, AuditPluginConfig } from '../types'
import { buildFieldMap } from '../utilities/buildFieldMap'
import { buildAuditConfig } from './auditFields'
import type { PluginContext } from './context'
import { resolveAuditLogConfig, resolveAuthConfig } from './resolveOptions'

type CollectionHooks = NonNullable<CollectionConfig['hooks']>

/** Attaches login and forgot-password logging when the collection asked for it. */
const withAuthHooks = ({
	auditOptions,
	ctx,
	hooks,
	slug,
}: {
	auditOptions: AuditOptions
	ctx: PluginContext
	hooks: CollectionHooks
	slug: CollectionSlug
}): CollectionHooks => {
	const authConfig = resolveAuthConfig(auditOptions)
	if (authConfig === false) return hooks

	const authOptions = {
		collectionSlug: slug,
		collectIpAddress: ctx.collectIpAddress,
		collectUserAgent: ctx.collectUserAgent,
		groupContextKey: ctx.groupContextKey,
		isUserPolymorphic: ctx.isUserPolymorphic,
	}

	const next: CollectionHooks = { ...hooks }
	if (authConfig.login) {
		next.afterLogin = [...(next.afterLogin ?? []), afterLoginAuditLog(authOptions)]
	}
	if (authConfig.forgotPassword) {
		next.afterForgotPassword = [
			...(next.afterForgotPassword ?? []),
			afterForgotPasswordAuditLog(authOptions),
		]
	}
	return next
}

const registerCollection = (
	collection: CollectionConfig,
	ctx: PluginContext,
	pluginOptions: AuditPluginConfig
): CollectionConfig => {
	// `CollectionConfig['slug']` is a plain string, while everything downstream is typed
	// against the generated slug union. Narrow once here rather than at each use.
	const slug = collection.slug as CollectionSlug
	const collectionOptions = pluginOptions.collections?.[slug]

	// Not listed means not audited, auth events included.
	if (!collectionOptions) return collection

	const { createdByHookConfig, fields, hasActiveFields, lastModifiedByHookConfig } =
		buildAuditConfig(
			collection.fields,
			collectionOptions,
			ctx.defaultRelationTo,
			pluginOptions.defaults
		)

	const auditLogConfig = resolveAuditLogConfig(collectionOptions)

	let hooks: CollectionHooks = { ...collection.hooks }

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
		const anonymize = pluginOptions.anonymize?.[slug]
		const isSelfTenant = Boolean(ctx.multiTenancy && ctx.tenantsSlug && slug === ctx.tenantsSlug)
		const tenantFieldName =
			!isSelfTenant && ctx.tenantFieldName && !ctx.multiTenancy?.excludeCollections?.includes(slug)
				? ctx.tenantFieldName
				: undefined
		const fieldMap =
			pluginOptions.normalizeRelationships !== false ? buildFieldMap(fields) : undefined

		hooks.afterChange = [
			...(hooks.afterChange ?? []),
			afterChangeCollectionAuditLog({
				anonymize,
				collectionSlug: slug,
				collectIpAddress: ctx.collectIpAddress,
				collectUserAgent: ctx.collectUserAgent,
				drafts: auditLogConfig.drafts ?? pluginOptions.drafts ?? 'ignore',
				excludeFields: [
					// Credentials would otherwise land in the diff on every password change.
					...(collection.auth ? ['hash', 'salt'] : []),
					...(auditLogConfig.excludeFields ?? []),
				],
				fieldMap,
				groupContextKey: ctx.groupContextKey,
				isUserPolymorphic: ctx.isUserPolymorphic,
				isSelfTenant,
				operations: auditLogConfig.operations,
				shouldLog: auditLogConfig.shouldLog,
				snapshotOnCreate: auditLogConfig.snapshotOnCreate,
				tenantFieldName,
			}),
		]

		// afterChange filters on `operations` inside the hook; afterDelete has no such
		// check, so the option has to be honoured at registration time.
		if (auditLogConfig.operations.includes('delete')) {
			hooks.afterDelete = [
				...(hooks.afterDelete ?? []),
				afterDeleteCollectionAuditLog({
					anonymize,
					collectionSlug: slug,
					collectIpAddress: ctx.collectIpAddress,
					collectUserAgent: ctx.collectUserAgent,
					fieldMap,
					groupContextKey: ctx.groupContextKey,
					isUserPolymorphic: ctx.isUserPolymorphic,
					isSelfTenant,
					shouldLog: auditLogConfig.shouldLog,
					snapshotOnDelete: auditLogConfig.snapshotOnDelete,
					tenantFieldName,
				}),
			]
		}
	}

	if (!pluginOptions.disabled && collection.auth) {
		hooks = withAuthHooks({ auditOptions: collectionOptions, ctx, hooks, slug })
	}

	return { ...collection, fields, hooks }
}

export const registerCollections = (
	config: Config,
	ctx: PluginContext,
	pluginOptions: AuditPluginConfig
): void => {
	config.collections = (config.collections ?? []).map((collection) =>
		registerCollection(collection, ctx, pluginOptions)
	)
}
