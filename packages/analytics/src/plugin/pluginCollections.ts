import type { CollectionConfig, Config, PayloadRequest } from 'payload'
import type { ResolvedOptions } from '../core/options'
import { buildGoalsCollection } from '../goals/collection'
import { STATE_SLUG } from '../native/collections/slugs'
import { stateCollection } from '../native/collections/state'
import type { BuildSecretField, ConnectionFieldAccess } from '../providers/collection'
import { buildProvidersCollection } from '../providers/collection'
import { cacheCollection } from '../surfacing/cacheCollection'
import { syncCollection } from '../sync/collection'
import type { StaticLabelFor } from '../translations/staticLabel'
import {
	checkEditorCollection,
	type ShapedCollection,
	shapeCollection,
	slugOfRole,
} from './collectionChecks'
import { loadEncrypted } from './encrypted'
import type { ScopeChange } from './scopeChange'

/** What the plugin's collections are registered against. */
export interface CollectionContext {
	/** `config.db.name`, which decides whether Postgres' identifier limit applies. */
	db: string | undefined
	/** Keeps what the boot warns about until the instance can log it. */
	notice: (message: string) => void
	/** The install's static labels, its own strings over the built-in ones. */
	staticLabel: StaticLabelFor
}

/** The collection a shaping produced, its notices handed on. */
const noticed = (shaped: ShapedCollection, context: CollectionContext): CollectionConfig => {
	for (const message of shaped.notices) {
		context.notice(message)
	}
	return shaped.collection
}

/** What the providers and goals collections call back into, the same whether the plugin runs or not. */
interface CollectionCallbacks {
	resolveAdminScope: (req: PayloadRequest) => Promise<string | null>
	/** Told what a save to either collection changed; a switched-off install's runtime is absent. */
	onChange: (
		collection: 'providers' | 'goals'
	) => (change: ScopeChange, req: PayloadRequest) => void
}

/**
 * Who may write a guarded provider field (the connection fields, `isDefault`), when anything
 * narrows the field's own access.
 */
const guardedFieldAccessOf = (
	resolved: ResolvedOptions,
	own: ConnectionFieldAccess | undefined
): ConnectionFieldAccess | undefined => {
	// A new document has no stored key to redirect, so only a host's own option gates create; an
	// update on a scoped install takes the named cross-scope gate.
	const update = own?.update ?? (resolved.scoped ? resolved.access.crossScope.named : undefined)
	const create = own?.create
	return create || update
		? { ...(create ? { create } : {}), ...(update ? { update } : {}) }
		: undefined
}

const providersCollectionOf = async (
	resolved: ResolvedOptions,
	callbacks: CollectionCallbacks,
	context: CollectionContext
): Promise<CollectionConfig> => {
	const { encryptedField, isSealed, withEncryptedQueryRewrite } = await loadEncrypted()
	const providers = resolved.providers.collection
	const keys = providers.encryption?.keys
	const buildSecret: BuildSecretField = (source) =>
		encryptedField(source, {
			protection: 'writeOnly',
			aadScope: '10x-analytics:providers',
			...(source.type === 'text' ? { hint: { suffix: 4 } } : {}),
			...(keys ? { keys } : {}),
		})
	const connectionAccess = guardedFieldAccessOf(resolved, providers.connectionAccess)
	const defaultAccess = guardedFieldAccessOf(
		resolved,
		providers.defaultAccess ?? providers.connectionAccess
	)
	const built = buildProvidersCollection({
		slug: providers.slug,
		access: providers.access,
		fields: providers.fields,
		overrides: providers.overrides,
		onChange: callbacks.onChange('providers'),
		scoped: resolved.scoped,
		scopeField: providers.scopeField,
		resolveScope: callbacks.resolveAdminScope,
		member: resolved.scope.member,
		crossScope: resolved.access.crossScope.named,
		buildSecret,
		isSealed,
		allowPrivateNetwork: resolved.providers.hosts.allowPrivateNetwork,
		...(connectionAccess ? { connectionAccess } : {}),
		...(defaultAccess ? { defaultAccess } : {}),
		types: providers.types,
		staticLabel: context.staticLabel,
		listNotice: [...resolved.sources.policies.values()].includes('fallback'),
	})
	const checked = checkEditorCollection(built, {
		role: 'providers',
		option: 'providers.collection',
		slug: providers.slug,
		db: context.db,
	})
	// Always wrapped: a second wrap by the host's fields plugin is inert (writeOnly has no blind
	// index), while skipping leaks ciphertext when fields() runs before this collection exists.
	return withEncryptedQueryRewrite(checked)
}

const goalsCollectionOf = (
	resolved: ResolvedOptions,
	callbacks: CollectionCallbacks,
	context: CollectionContext
): CollectionConfig => {
	const goals = resolved.goalsCollection
	const built = buildGoalsCollection({
		slug: goals.slug,
		access: goals.access,
		fields: goals.fields,
		overrides: goals.overrides,
		onChange: callbacks.onChange('goals'),
		revenue: resolved.revenue.enabled,
		// A per-scope resolver has no request to answer for here, so only a fixed code is
		// offered as the default.
		...(typeof resolved.revenue.currency === 'string'
			? { defaultCurrency: resolved.revenue.currency }
			: {}),
		scoped: resolved.scoped,
		scopeField: goals.scopeField,
		resolveScope: callbacks.resolveAdminScope,
		member: resolved.scope.member,
		crossScope: resolved.access.crossScope.named,
		staticLabel: context.staticLabel,
	})
	return checkEditorCollection(built, {
		role: 'goals',
		option: 'goals.collection',
		slug: goals.slug,
		db: context.db,
	})
}

/**
 * The providers and goals collections an install turned on, built exactly alike whether the plugin
 * runs or only keeps its schema (`disabled: true`), so neither drops a field or an index.
 */
export const configCollections = async (
	resolved: ResolvedOptions,
	callbacks: CollectionCallbacks,
	context: CollectionContext
): Promise<CollectionConfig[]> => [
	...(resolved.providers.collection.enabled
		? [await providersCollectionOf(resolved, callbacks, context)]
		: []),
	...(resolved.goalsCollection.enabled ? [goalsCollectionOf(resolved, callbacks, context)] : []),
]

/**
 * The sync collection when sync is on, after the host's overrides, built alike whether the plugin
 * runs or not.
 */
export const syncCollectionOf = (
	resolved: ResolvedOptions,
	resolveAdminScope: CollectionCallbacks['resolveAdminScope'],
	context: CollectionContext
): CollectionConfig | undefined => {
	if (!resolved.sync.enabled) {
		return undefined
	}
	const { slug, hidden, overrides } = resolved.sync.collection
	const built = syncCollection(slug, {
		hidden,
		access: {
			scoped: resolved.scoped,
			scopeField: 'scope',
			resolveScope: resolveAdminScope,
			member: resolved.scope.member,
			crossScope: resolved.access.crossScope.named,
		},
		read: resolved.access.read,
		staticLabel: context.staticLabel,
	})
	return noticed(
		shapeCollection(built, {
			role: 'sync',
			option: 'sync.collection',
			db: context.db,
			...(overrides ? { overrides } : {}),
		}),
		context
	)
}

/** The read cache collection after the host's overrides, unless a `cache.store` replaces it. */
export const cacheCollectionOf = (
	resolved: ResolvedOptions,
	context: CollectionContext
): CollectionConfig | undefined => {
	if (resolved.cache.store) {
		return undefined
	}
	const { slug, overrides } = resolved.cache.collection
	const built = cacheCollection({ slug, mongo: context.db === 'mongoose' })
	return noticed(
		shapeCollection(built, {
			role: 'cache',
			option: 'cache.collection',
			db: context.db,
			...(overrides ? { overrides } : {}),
		}),
		context
	)
}

/**
 * Whether the install registers a task that takes a lease and stamps a heartbeat, which live in
 * `analytics-state`: sync or warming, while `jobs` registers tasks.
 */
const needsStateCollection = (resolved: ResolvedOptions): boolean =>
	resolved.jobs !== false && (resolved.sync.enabled || resolved.cache.warm.enabled)

/**
 * `analytics-state` for the sync and warm tasks, after `jobs.state`, unless an adapter (the native
 * engine) registered its own. Refuses `jobs.state` wherever it would shape nothing.
 */
export const addStateCollection = (
	config: Config,
	resolved: ResolvedOptions,
	context: CollectionContext
): void => {
	const option = resolved.jobs === false ? undefined : resolved.jobs.state
	const registered = slugOfRole(config.collections, 'state')
	if (option && registered !== undefined) {
		throw new Error(
			`analytics: jobs.state shapes the analytics-state collection of an install without native(), but native() registers its own ("${registered}"). Rename or reshape it with native({ collections: { state } }) instead.`
		)
	}
	if (!needsStateCollection(resolved)) {
		if (option) {
			throw new Error(
				'analytics: jobs.state shapes the collection the sync and warm tasks keep their leases in, and this install runs neither. Turn sync or cache.warm on, or remove it.'
			)
		}
		return
	}
	if (registered !== undefined) {
		return
	}
	const state = noticed(
		shapeCollection(stateCollection(option?.slug ?? STATE_SLUG), {
			role: 'state',
			option: 'jobs.state',
			db: context.db,
			...(option?.overrides ? { overrides: option.overrides } : {}),
		}),
		context
	)
	config.collections = [...(config.collections ?? []), state]
}
