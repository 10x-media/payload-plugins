import { createLocalReq, type Payload } from 'payload'
import { currentTime } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import type { AnalyticsAdapter, AnalyticsCapabilities } from '../core/contract'
import type { FetchLike } from '../core/fetch'
import type { ProvidersResolve } from '../core/options'
import {
	type AdapterRegistry,
	NO_GRANTS,
	type RegistryResolver,
	type ScopeRegistry,
} from '../core/registry'
import type { AnalyticsSdks } from '../core/sdks'
import { SourceMisconfiguredError } from '../core/sourceErrors'
import { throttled } from '../core/throttle'
import { isRecord, valueAt } from '../core/values'
import { loadEncrypted } from '../plugin/encrypted'
import { GA4_SDK_WARNING, isProductionBuild } from '../plugin/peers'
import { remember } from '../surfacing/bounded'
import { createEpochFallback, type EpochStore, FIXED_CONFIG_EPOCH } from '../surfacing/epoch'
import { createAdapterPool, type PooledDocument } from './adapterPool'
import {
	adapterFromProviderDoc,
	documentAdapterId,
	failingAdapter,
	PROVIDER_IDS,
	type ProviderDoc,
	type ProviderId,
} from './factory'
import type { ProviderHostPolicy } from './hosts'
import { createCollectionProbe, type Probe, type ProbeRow, scopeOf, versionOf } from './probe'
import {
	combineRegistries,
	noGuardedConnection,
	type ProviderAdapter,
	providerScopeWhere,
	type RegistryBase,
} from './resolver'
import { SECRET_PATHS } from './secrets'

/** How often a failing probe is reported, at most. */
const WARN_EVERY_MS = 60_000

/**
 * How long a document whose adapter could not be built (its secrets did not decrypt, its settings
 * threw) stands in as a failing source before its scope's registry reads it again.
 */
export const FAILED_DOCUMENT_RETRY_MS = 60_000

/** Where an install's runtime provider adapters come from. */
export type ProviderPlan =
	| { kind: 'static' }
	| {
			kind: 'collection'
			slug: string
			scopeField: string
			/** Types the install serves, every one when absent; a document of another is no source. */
			types?: readonly ProviderId[]
			/** The install's config native adapter, which a `native` document grants to its scope. */
			nativeAdapter?: AnalyticsAdapter
	  }
	| { kind: 'resolve'; resolve: ProvidersResolve }

interface ProviderRegistryOptions {
	payload: Payload
	plan: ProviderPlan
	/** The config adapters every scope's registry starts from. */
	base: RegistryBase
	/** The config registry as an install without runtime providers hands it out. */
	registry: AdapterRegistry
	/** Applied to every scope's registry: revenue removed on an install that measures no money. */
	narrow: (registry: AdapterRegistry) => AdapterRegistry
	hosts: ProviderHostPolicy
	/** Missing, every document adapter refuses rather than going out unguarded. */
	fetch: FetchLike | undefined
	sdks: AnalyticsSdks
	/** A `providers.resolve` install's configuration tokens, which `refresh` bumps. */
	tokens?: EpochStore
	now?: () => number
}

/** One instance's runtime provider adapters, and the epoch that says when they changed. */
interface ProviderRegistry {
	resolve: RegistryResolver
	/** The scope's provider configuration epoch, which every cache key carries. */
	epoch(scope: string | null): Promise<string>
	/**
	 * Whether the scope's own available documents grant `adapterId`, as its registry does. The native
	 * adapter is answered from the committed rows alone, decrypting nothing, so a beacon stays cheap.
	 * Only on the providers collection.
	 */
	granted?(scope: string | null, adapterId: string): Promise<boolean>
	/** A save on this instance touched these scopes, which it then reads again as soon as it commits. */
	changed(scopes: Iterable<string | null>): void
	/** Retires the scope's cached reads on every instance: `refreshProviders()`. */
	refresh(scope: string | null): Promise<void>
	close(): Promise<void>
}

type DecryptFieldValue = Awaited<ReturnType<typeof loadEncrypted>>['decryptFieldValue']

/** Sets a `group.field` secret in place; a document without that group is left as it is. */
const setAtPath = (doc: Record<string, unknown>, path: string, value: string): void => {
	const [group = '', field] = path.split('.')
	const target = doc[group]
	if (field !== undefined && isRecord(target)) {
		target[field] = value
	}
}

/** The secrets a document stores, by path; blank ones are left out. */
const storedSecrets = (doc: Record<string, unknown>): Array<{ path: string; value: string }> =>
	SECRET_PATHS.flatMap(({ path }) => {
		const value = valueAt(doc, path)
		return typeof value === 'string' && value !== '' ? [{ path, value }] : []
	})

const refOf = (doc: { id: string; version: string }): string => `${doc.id}@${doc.version}`

/** The registry of an install without runtime providers: the config adapters, for every scope. */
const staticRegistry = (options: ProviderRegistryOptions): ProviderRegistry => ({
	resolve: async () => ({ registry: options.registry, grants: NO_GRANTS }),
	epoch: async () => FIXED_CONFIG_EPOCH,
	changed: () => {},
	refresh: async () => {},
	close: async () => {},
})

/**
 * `providers.resolve`: the host's function answers every read, uncached, and the configuration
 * epoch is a token the host bumps through `refreshProviders()` once it changed its own storage.
 */
const resolveRegistry = (
	options: ProviderRegistryOptions,
	resolve: ProvidersResolve
): ProviderRegistry => {
	const { tokens } = options
	return {
		resolve: async ({ payload, req, scope }) => {
			const adapters = await resolve({
				payload,
				req,
				scope,
				fetch: options.fetch ?? noGuardedConnection,
				hosts: options.hosts,
				sdks: options.sdks,
			})
			const combined = combineRegistries(
				options.base,
				adapters.map((adapter) => ({ adapter, docId: adapter.id }))
			)
			return { ...combined, registry: options.narrow(combined.registry) }
		},
		epoch: (scope) => tokens?.get(scope) ?? Promise.resolve(FIXED_CONFIG_EPOCH),
		changed: () => {},
		refresh: async (scope) => {
			await tokens?.bump(scope)
		},
		close: async () => {},
	}
}

interface CachedRegistry {
	epoch: string
	resolved: Promise<ScopeRegistry>
	/** The enabled documents it was built from, kept in use while it is handed out. */
	ids: readonly string[]
	/** Each as `id@updatedAt`, so disposing a version drops exactly the registries built on it. */
	refs: ReadonlySet<string>
	/** Set when a document stood in as a failing source: the registry is built again from then on. */
	retryAt?: number
}

/** What one document built: its adapter, or a stand-in when it could not be read. */
type Built =
	| { ok: true; adapter: AnalyticsAdapter | null }
	| { ok: false; standIn: AnalyticsAdapter }

/** What a stand-in declares when the document's settings build nothing even without its secrets. */
const STAND_IN_CAPABILITIES: AnalyticsCapabilities = {
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews', 'visitors']),
	dimensions: new Set(),
	filters: {},
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 60 },
}

/**
 * Stands in while a document's adapter cannot be built: keeps its identity, and its capabilities
 * where settings build without secrets; reads fail as `source_misconfigured`, capture none.
 */
const standInFor = (
	raw: Record<string, unknown>,
	cause: unknown,
	build: (doc: Record<string, unknown>) => AnalyticsAdapter | null
): AnalyticsAdapter => {
	const blank = structuredClone(raw)
	for (const { path } of storedSecrets(blank)) {
		setAtPath(blank, path, '')
	}
	let shape: AnalyticsAdapter | null = null
	try {
		shape = build(blank)
	} catch {
		shape = null
	}
	const id = documentAdapterId(raw.provider, raw.id)
	return failingAdapter(
		{
			id,
			label: shape?.label ?? (typeof raw.name === 'string' && raw.name !== '' ? raw.name : id),
			capabilities: shape?.capabilities ?? STAND_IN_CAPABILITIES,
			realtime: shape?.realtime,
		},
		() =>
			new SourceMisconfiguredError(
				`analytics: provider document "${String(raw.id)}" could not be read; check its settings and keys`,
				{ cause }
			)
	)
}

/**
 * A scope's registry is cached under the epoch the probe reads before any document, so it is never
 * filed under an older epoch. Only unseen document versions are read and decrypted.
 */
const collectionRegistry = (
	options: ProviderRegistryOptions,
	plan: Extract<ProviderPlan, { kind: 'collection' }>
): ProviderRegistry => {
	const { payload, now } = options
	const { slug } = plan
	const probe = createCollectionProbe({
		payload,
		slug,
		scopeField: plan.scopeField,
		where: (scope) => providerScopeWhere(plan.scopeField, scope),
		provider: true,
		...(now ? { now } : {}),
	})
	const registries = new Map<string, CachedRegistry>()
	const pool = createAdapterPool({
		payload,
		...(now ? { now } : {}),
		onDispose: (doc) => {
			const ref = refOf(doc)
			for (const [key, cached] of registries) {
				if (cached.refs.has(ref)) {
					registries.delete(key)
				}
			}
		},
	})
	let warnedGa4 = false
	const clock = now ?? currentTime
	const warnProbeFailed = throttled((message) => payload.logger?.warn(message), {
		now: clock,
		intervalMs: WARN_EVERY_MS,
	})
	// A failing probe keys on the last epoch read, which the registry in use was built from.
	const fallback = createEpochFallback(clock)
	const types: readonly string[] = plan.types ?? PROVIDER_IDS

	/** An enabled document of a type the install serves, which its adapter may then make a source. */
	const servable = (row: ProbeRow): boolean => row.enabled && types.includes(row.provider ?? '')

	/** A probed id as the collection stores it: rows carry every id as text. */
	const idOf = (id: string): string | number => {
		const custom = isCollectionSlug(payload, slug)
			? payload.collections[slug]?.customIDType
			: undefined
		return (custom ?? payload.db.defaultIDType) === 'number' && /^\d+$/.test(id) ? Number(id) : id
	}

	const fromDocument = (doc: Record<string, unknown>): AnalyticsAdapter | null =>
		// A row of the providers collection, whose fields `ProviderDoc` mirrors.
		adapterFromProviderDoc(doc as ProviderDoc, {
			...(plan.nativeAdapter ? { native: plan.nativeAdapter } : {}),
			hosts: options.hosts,
			fetch: options.fetch ?? noGuardedConnection,
			sdks: options.sdks,
		})

	const adapterOf = async (
		raw: Record<string, unknown>,
		decrypt: DecryptFieldValue
	): Promise<Built> => {
		try {
			const doc = structuredClone(raw)
			for (const { path, value } of storedSecrets(doc)) {
				const plain = await decrypt(payload, { collection: slug, path, value })
				setAtPath(doc, path, typeof plain === 'string' ? plain : '')
			}
			const adapter = fromDocument(doc)
			// The first GA4 document is the earliest this install shows it reads GA4 at all.
			if (raw.provider === 'ga4' && !options.sdks.ga4 && !warnedGa4 && isProductionBuild()) {
				warnedGa4 = true
				payload.logger?.warn(GA4_SDK_WARNING)
			}
			return { ok: true, adapter }
		} catch (err) {
			// A corrupt or key-rotated ciphertext must neither take the scope's registry down nor drop
			// the source silently: it stands in as a failing source until the retry.
			payload.logger?.warn(
				`analytics: provider document "${String(raw.id)}" (${String(raw.provider)}) could not be read, its reads fail until it can: ${String(err)}`
			)
			return { ok: false, standIn: standInFor(raw, err, fromDocument) }
		}
	}

	/**
	 * Reads and builds the documents the pool has no adapter for, answering each by id. A stand-in
	 * is never pooled, so the document is read again once its registry expires.
	 */
	const buildDocuments = async (
		scope: string | null,
		ids: readonly string[]
	): Promise<{ built: Map<string, AnalyticsAdapter | null>; failed: boolean }> => {
		if (!isCollectionSlug(payload, slug)) {
			throw new Error(`analytics: no "${slug}" collection is registered for the providers`)
		}
		const { decryptFieldValue, withRawEncrypted } = await loadEncrypted()
		// Never the caller's: the raw window is not a concurrency boundary, so a request shared with
		// other reads would hand them ciphertext, and it may also hold an uncommitted transaction.
		const req = await createLocalReq({}, payload)
		const { docs } = await withRawEncrypted(req, () =>
			payload.find({
				collection: slug,
				where: {
					and: [
						{ id: { in: ids.map(idOf) } },
						{ enabled: { equals: true } },
						providerScopeWhere(plan.scopeField, scope),
					],
				},
				limit: ids.length,
				pagination: false,
				depth: 0,
				overrideAccess: true,
				req,
			})
		)
		const found: unknown[] = docs
		const built = new Map<string, AnalyticsAdapter | null>()
		let failed = false
		for (const raw of found.filter(isRecord)) {
			const doc: PooledDocument = { id: String(raw.id), version: versionOf(raw.updatedAt), scope }
			const outcome = await adapterOf(raw, decryptFieldValue)
			if (outcome.ok) {
				built.set(doc.id, pool.put(doc, outcome.adapter, raw.provider !== 'native'))
			} else {
				built.set(doc.id, outcome.standIn)
				failed = true
			}
		}
		return { built, failed }
	}

	const build = async (
		scope: string | null,
		docs: readonly PooledDocument[],
		flagged: ReadonlySet<string>
	): Promise<{ registry: ScopeRegistry; failed: boolean }> => {
		const missing = docs.filter((doc) => pool.get(doc) === undefined).map((doc) => doc.id)
		const read = missing.length > 0 ? await buildDocuments(scope, missing) : undefined
		const extras: ProviderAdapter[] = []
		for (const doc of docs) {
			const adapter = read?.built.has(doc.id) ? read.built.get(doc.id) : pool.get(doc)
			// Lacking what its adapter reads with, a document is no source and grants nothing; a
			// stand-in for one that failed to decrypt still is, configured but failing.
			if (adapter?.isConfigured()) {
				extras.push({ adapter, docId: doc.id, isDefault: flagged.has(doc.id) })
			}
		}
		pool.retain(scope, new Set(docs.map((doc) => doc.id)))
		const combined = combineRegistries(options.base, extras)
		return {
			registry: { ...combined, registry: options.narrow(combined.registry) },
			failed: read?.failed === true,
		}
	}

	const probed = async (scope: string | null): Promise<Probe | undefined> => {
		try {
			return await probe.read(scope)
		} catch (err) {
			warnProbeFailed(
				`analytics: reading the provider documents failed, cached reads key on the last epoch this instance read: ${String(err)}`
			)
			return undefined
		}
	}

	const isCurrent = (cached: CachedRegistry, epoch: string): boolean =>
		cached.epoch === epoch && (cached.retryAt === undefined || clock() < cached.retryAt)

	const registryOf = async (scope: string | null): Promise<ScopeRegistry> => {
		const key = scope ?? ''
		const state = await probe.read(scope)
		fallback.read(scope, state.epoch)
		const cached = registries.get(key)
		if (cached && isCurrent(cached, state.epoch)) {
			pool.touch(cached.ids)
			return cached.resolved
		}
		const rows = state.rows.filter(servable)
		const docs: PooledDocument[] = rows.map((row) => ({
			id: row.id,
			version: row.updatedAt,
			scope,
		}))
		const flagged = new Set(rows.filter((row) => row.isDefault).map((row) => row.id))
		const built = build(scope, docs, flagged)
		const entry: CachedRegistry = {
			epoch: state.epoch,
			resolved: built.then((done) => done.registry),
			ids: docs.map((doc) => doc.id),
			refs: new Set(docs.map(refOf)),
		}
		built.then(
			(done) => {
				if (done.failed) {
					entry.retryAt = clock() + FAILED_DOCUMENT_RETRY_MS
				}
			},
			() => {}
		)
		remember(registries, [key, entry])
		entry.resolved.catch(() => {
			if (registries.get(key) === entry) {
				registries.delete(key)
			}
		})
		return entry.resolved
	}

	return {
		resolve: (args) => registryOf(scopeOf(args.scope)),
		epoch: async (raw) => {
			const scope = scopeOf(raw)
			const state = await probed(scope)
			return state ? fallback.read(scope, state.epoch) : fallback.failed(scope)
		},
		granted: async (raw, adapterId) => {
			const scope = scopeOf(raw)
			const native = plan.nativeAdapter
			if (native && native.id === adapterId) {
				const { rows } = await probe.read(scope)
				return (
					native.isConfigured() && rows.some((row) => row.provider === 'native' && servable(row))
				)
			}
			return (await registryOf(scope)).grants.has(adapterId)
		},
		changed: (scopes) => probe.expedite(scopes),
		refresh: async (scope) => probe.expedite([scope]),
		close: () => pool.close(),
	}
}

/** The runtime provider registry of one Payload instance, for the install's plan. */
export const createProviderRegistry = (options: ProviderRegistryOptions): ProviderRegistry => {
	const { plan } = options
	switch (plan.kind) {
		case 'collection':
			return collectionRegistry(options, plan)
		case 'resolve':
			return resolveRegistry(options, plan.resolve)
		default:
			return staticRegistry(options)
	}
}
