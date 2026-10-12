import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import type { AnalyticsAdapter, AnalyticsResult } from '../core/contract'
import type { FetchLike } from '../core/fetch'
import type { AnalyticsSdks } from '../core/sdks'
import { HostRefusedError } from '../core/sourceErrors'
import { isRecord } from '../core/values'
import { checkDocumentHost, type DocumentHost, type ProviderHostPolicy } from './hosts'

export const PROVIDER_IDS = ['native', 'plausible', 'umami', 'ga4', 'posthog'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** The provider-settings document shape the adapter factory reads (depth 0, secrets revealed). */
export type ProviderDoc = {
	id?: number | string
	name?: string | null
	provider?: string | null
	enabled?: boolean | null
	scope?: string | null
	plausible?: {
		siteId?: string | null
		apiKey?: string | null
		host?: string | null
		domain?: string | null
		scriptId?: string | null
		revenueCurrency?: string | null
	} | null
	umami?: {
		websiteId?: string | null
		apiKey?: string | null
		token?: string | null
		host?: string | null
	} | null
	ga4?: {
		propertyId?: string | null
		clientEmail?: string | null
		privateKey?: string | null
		projectId?: string | null
		measurementId?: string | null
		currency?: string | null
	} | null
	posthog?: {
		projectId?: string | null
		apiKey?: string | null
		host?: string | null
		projectToken?: string | null
		region?: string | null
		scopeProperty?: string | null
	} | null
}

/** A stored blank reads as unset. */
const orUndefined = (value: string | null | undefined): string | undefined => value || undefined

/** An unset or unrecognized stored region falls back to host-derived detection. */
const posthogRegion = (value: string | null | undefined): 'us' | 'eu' | undefined =>
	value === 'us' || value === 'eu' ? value : undefined

/**
 * Keys pasted from a service-account JSON often carry escaped newlines; the gRPC
 * client needs real ones.
 */
export const normalizePrivateKey = (key: string): string => key.replace(/\\n/g, '\n')

const shortId = (id: number | string): string => String(id).slice(-6)

/** The registry id of a provider document's adapter, which grants and stand-ins must match. */
export const documentAdapterId = (provider: unknown, id: unknown): string =>
	`${String(provider)}:${String(id)}`

/** A lent `native` adapter under the document's name, so a source reads as its tenant named it. */
const withDocumentLabel = (adapter: AnalyticsAdapter, doc: ProviderDoc): AnalyticsAdapter =>
	doc.name ? { ...adapter, label: doc.name } : adapter

/** Per-document ids keep two projects of one provider type apart in a registry. */
const withInstanceIdentity = (adapter: AnalyticsAdapter, doc: ProviderDoc): AnalyticsAdapter => {
	if (doc.id === undefined || doc.id === null || doc.id === '') {
		return adapter
	}
	return {
		...adapter,
		id: documentAdapterId(doc.provider, doc.id),
		label: doc.name || `${adapter.label} ${shortId(doc.id)}`,
	}
}

/**
 * Keeps `shape`'s identity and capabilities so the source still lists, but every read throws
 * `error()` and it declares no capture, so its proxy mount answers 404.
 */
export const failingAdapter = (
	shape: Pick<AnalyticsAdapter, 'id' | 'label' | 'capabilities' | 'realtime'>,
	error: () => Error
): AnalyticsAdapter => {
	const fail = async (): Promise<AnalyticsResult> => {
		throw error()
	}
	return {
		id: shape.id,
		label: shape.label,
		capabilities: shape.capabilities,
		isConfigured: () => true,
		query: fail,
		...(shape.realtime ? { realtime: fail } : {}),
	}
}

/**
 * Builds a hosted vendor's adapter on the address its host check allowed, none being the vendor's
 * cloud; a refused host builds one whose reads fail with a `HostRefusedError`.
 */
const onDocumentHost = (
	verdict: DocumentHost,
	build: (host: string | undefined) => AnalyticsAdapter
): AnalyticsAdapter => {
	if (verdict.ok) {
		return build(verdict.address ?? undefined)
	}
	const { host, reason } = verdict
	return failingAdapter(build(undefined), () => new HostRefusedError(host, reason))
}

const buildBaseAdapter = (
	doc: ProviderDoc,
	ctx: ProviderFactoryContext
): AnalyticsAdapter | null => {
	switch (doc.provider) {
		case 'native':
			return ctx.native ?? null
		case 'plausible': {
			const cfg = doc.plausible ?? {}
			return onDocumentHost(checkDocumentHost('plausible', cfg.host, ctx.hosts), (host) =>
				plausible({
					siteId: cfg.siteId ?? '',
					apiKey: cfg.apiKey ?? '',
					host,
					domain: orUndefined(cfg.domain),
					scriptId: orUndefined(cfg.scriptId),
					revenueCurrency: orUndefined(cfg.revenueCurrency),
					fetch: ctx.fetch,
				})
			)
		}
		case 'umami': {
			const cfg = doc.umami ?? {}
			return onDocumentHost(checkDocumentHost('umami', cfg.host, ctx.hosts), (host) =>
				umami({
					websiteId: cfg.websiteId ?? '',
					apiKey: orUndefined(cfg.apiKey),
					token: orUndefined(cfg.token),
					host,
					fetch: ctx.fetch,
				})
			)
		}
		case 'ga4': {
			const cfg = doc.ga4 ?? {}
			return ga4({
				propertyId: cfg.propertyId ?? '',
				credentials: {
					client_email: cfg.clientEmail ?? '',
					private_key: normalizePrivateKey(cfg.privateKey ?? ''),
				},
				projectId: orUndefined(cfg.projectId),
				measurementId: orUndefined(cfg.measurementId),
				currency: orUndefined(cfg.currency),
				...(ctx.sdks?.ga4 ? { sdk: ctx.sdks.ga4 } : {}),
			})
		}
		case 'posthog': {
			const cfg = doc.posthog ?? {}
			return onDocumentHost(checkDocumentHost('posthog', cfg.host, ctx.hosts), (host) =>
				posthog({
					projectId: cfg.projectId ?? '',
					apiKey: cfg.apiKey ?? '',
					host,
					projectToken: orUndefined(cfg.projectToken),
					region: posthogRegion(cfg.region),
					scopeProperty: orUndefined(cfg.scopeProperty?.trim()),
					fetch: ctx.fetch,
				})
			)
		}
		default:
			return null
	}
}

/**
 * What the factory needs to build a document's adapter: `fetch` and `hosts` keep a stored key on a
 * host the install allows.
 *
 * @beta
 */
export interface ProviderFactoryContext {
	/** The guarded fetch `providers.resolve` receives, or one from `createGuardedFetch`. */
	fetch: FetchLike
	/**
	 * The policy `providers.resolve` receives, or one from `resolveHostPolicy`: a host outside it
	 * builds an adapter that reads as `source_misconfigured` and captures nothing.
	 */
	hosts: ProviderHostPolicy
	/**
	 * The install's config native adapter, which a `native` document grants rather than building a
	 * second one.
	 */
	native?: AnalyticsAdapter
	/** The plugin's `sdks`: a GA4 document's adapter reads through `sdks.ga4`. */
	sdks?: AnalyticsSdks
}

/** Checked at runtime: a JavaScript caller can leave the guards out, which would go out unguarded. */
const isGuarded = (ctx: unknown): ctx is ProviderFactoryContext =>
	isRecord(ctx) &&
	typeof ctx.fetch === 'function' &&
	isRecord(ctx.hosts) &&
	Array.isArray(ctx.hosts.allow)

/**
 * Builds a provider document's adapter: missing credentials read as `isConfigured() === false`, an
 * unknown provider as null, and a `native` document lends the config adapter under its label.
 */
export const adapterFromProviderDoc = (
	doc: ProviderDoc,
	ctx: ProviderFactoryContext
): AnalyticsAdapter | null => {
	if (!isGuarded(ctx)) {
		throw new Error(
			'analytics: adapterFromProviderDoc needs { fetch, hosts }: pass the ones providers.resolve receives'
		)
	}
	const base = buildBaseAdapter(doc, ctx)
	if (!base) {
		return null
	}
	return doc.provider === 'native' ? withDocumentLabel(base, doc) : withInstanceIdentity(base, doc)
}
