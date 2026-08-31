import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import type { AnalyticsAdapter } from '../core/contract'

export const PROVIDER_IDS = ['plausible', 'umami', 'ga4', 'posthog'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** The provider-settings document shape the adapter factory reads (depth 0, secrets revealed). */
export type ProviderDoc = {
	id?: number | string
	name?: string | null
	provider?: string | null
	enabled?: boolean | null
	scope?: string | null
	plausible?: { siteId?: string | null; apiKey?: string | null; host?: string | null } | null
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
	} | null
	posthog?: { projectId?: string | null; apiKey?: string | null; host?: string | null } | null
}

const orUndefined = (value: string | null | undefined): string | undefined => value || undefined

/**
 * Keys pasted from a service-account JSON often carry escaped newlines; the gRPC
 * client needs real ones.
 */
export const normalizePrivateKey = (key: string): string => key.replace(/\\n/g, '\n')

const shortId = (id: number | string): string => String(id).slice(-6)

/** Runtime adapters carry a per-document instance id so two projects of one provider type never collide in a registry; config adapters keep their plain ids. */
const withInstanceIdentity = (adapter: AnalyticsAdapter, doc: ProviderDoc): AnalyticsAdapter => {
	if (doc.id === undefined || doc.id === null || doc.id === '') {
		return adapter
	}
	return {
		...adapter,
		id: `${doc.provider}:${doc.id}`,
		label: doc.name || `${adapter.label} ${shortId(doc.id)}`,
	}
}

const buildBaseAdapter = (doc: ProviderDoc): AnalyticsAdapter | null => {
	switch (doc.provider) {
		case 'plausible': {
			const cfg = doc.plausible ?? {}
			return plausible({
				siteId: cfg.siteId ?? '',
				apiKey: cfg.apiKey ?? '',
				host: orUndefined(cfg.host),
			})
		}
		case 'umami': {
			const cfg = doc.umami ?? {}
			return umami({
				websiteId: cfg.websiteId ?? '',
				apiKey: orUndefined(cfg.apiKey),
				token: orUndefined(cfg.token),
				host: orUndefined(cfg.host),
			})
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
			})
		}
		case 'posthog': {
			const cfg = doc.posthog ?? {}
			return posthog({
				projectId: cfg.projectId ?? '',
				apiKey: cfg.apiKey ?? '',
				host: orUndefined(cfg.host),
			})
		}
		default:
			return null
	}
}

/**
 * Build an adapter instance from a provider-settings document using the same
 * constructors as config-time adapters. Missing credentials are passed through as
 * empty strings so the adapter reports `isConfigured() === false` instead of the
 * factory throwing; an unknown provider value returns null and is skipped.
 */
export const adapterFromProviderDoc = (doc: ProviderDoc): AnalyticsAdapter | null => {
	const base = buildBaseAdapter(doc)
	return base ? withInstanceIdentity(base, doc) : null
}
