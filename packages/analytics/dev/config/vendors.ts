// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import {
	type AnalyticsAdapter,
	type AnalyticsPluginOptions,
	analytics,
	type CrossScopeAccess,
	type ProvidersResolve,
	type ScopeMemberAccess,
	type ScopeResolver,
} from '@10x-media/analytics'
import { ga4 } from '@10x-media/analytics/adapters/ga4'
import { native } from '@10x-media/analytics/adapters/native'
import { plausible } from '@10x-media/analytics/adapters/plausible'
import { posthog } from '@10x-media/analytics/adapters/posthog'
import { umami } from '@10x-media/analytics/adapters/umami'
import {
	E2E_GA4_MEASUREMENT_ID,
	E2E_PLAIN_SITE_SCOPE,
	E2E_PLAUSIBLE_DOMAIN,
	E2E_POSTHOG_TOKENS,
	E2E_SITE_ADAPTER_ID,
	E2E_UMAMI_WEBSITE_ID,
	E2E_UPSTREAM_BASES,
	type E2eVendorProfile,
	type E2eVendorSite,
	e2eVendorSite,
} from '../helpers/e2eVendors'
import {
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	devSiteAddress,
	pagesBinding,
	sharedDashboardLayout,
	sharedGoals,
	sharedRevenue,
	sharedSkip,
	sharedWidgets,
} from './shared'

/** The mock vendor upstream the Playwright run starts; nothing here reaches a real vendor. */
const upstream = (): string => {
	const address = process.env.ANALYTICS_E2E_UPSTREAM
	if (!address) {
		throw new Error('ANALYTICS_E2E_VENDORS needs ANALYTICS_E2E_UPSTREAM, the mock vendor address')
	}
	return address.replace(/\/+$/, '')
}

const posthogClient = (client: keyof typeof E2E_POSTHOG_TOKENS, base: string): AnalyticsAdapter =>
	posthog({
		projectId: '1',
		apiKey: 'phx_e2e_dummy',
		host: `${upstream()}${base}`,
		projectToken: E2E_POSTHOG_TOKENS[client],
	})

/** Each vendor site's adapter, renamed so one `capture.slots.tenant` id fills the slot on every site. */
const siteAdapter = (site: E2eVendorSite, profile: E2eVendorProfile): AnalyticsAdapter | null => {
	const build = (): AnalyticsAdapter | null => {
		switch (site) {
			case 'plausible':
				return profile === 'pair'
					? null
					: plausible({
							siteId: E2E_PLAUSIBLE_DOMAIN,
							apiKey: 'e2e-dummy',
							domain: E2E_PLAUSIBLE_DOMAIN,
							host: `${upstream()}${E2E_UPSTREAM_BASES.plausible}`,
						})
			case 'umami':
				return profile === 'pair'
					? null
					: umami({
							websiteId: E2E_UMAMI_WEBSITE_ID,
							token: 'e2e-dummy',
							host: `${upstream()}${E2E_UPSTREAM_BASES.umami}`,
						})
			case 'posthog':
				return posthogClient('tenant', E2E_UPSTREAM_BASES.posthogTenant)
			case 'ga4':
				return profile === 'pair'
					? null
					: ga4({
							propertyId: '1',
							credentials: { client_email: 'e2e@example.com', private_key: 'e2e-dummy' },
							measurementId: E2E_GA4_MEASUREMENT_ID,
							// GA4 is strict unless opted in; the strict profile leaves it at that default.
							...(profile === 'strict' ? {} : { withoutConsent: 'cookieless' as const }),
						})
		}
	}
	const adapter = build()
	return adapter ? { ...adapter, id: E2E_SITE_ADAPTER_ID } : null
}

/**
 * A visit's scope is the vendor site its host names, else the plain site's. A scoped install's ingest
 * drops a beacon no scope answers for, so the plain site needs one; the admin reads it.
 */
const resolveVendorScope: ScopeResolver = ({ req, callSite }) =>
	(callSite === 'capture' ? e2eVendorSite(req.headers.get('host')) : undefined) ??
	E2E_PLAIN_SITE_SCOPE

/** The seeded admin is the only user, so whoever signs in reads every vendor site. */
const signedIn: CrossScopeAccess & ScopeMemberAccess = ({ req }) => Boolean(req.user)

/**
 * The vendor e2e playground: native on the global slot (a PostHog client on the `pair` profile)
 * and, on `<vendor>.localhost`, that vendor's adapter on the tenant slot, every one pointed at the
 * mock upstream. Single-site otherwise, so it boots on the single-site migrations.
 */
export const vendorsFragment = (profile: E2eVendorProfile): DevConfigFragment => {
	const nativeAdapter = profile === 'anonymous' ? native({ withoutConsent: 'anonymous' }) : native()
	const globalPosthog =
		profile === 'pair' ? posthogClient('global', E2E_UPSTREAM_BASES.posthogGlobal) : undefined
	const resolveProviders: ProvidersResolve = ({ scope }) => {
		const site = e2eVendorSite(scope === null ? null : `${scope}.localhost`)
		const adapter = site ? siteAdapter(site, profile) : null
		return adapter ? [adapter] : []
	}
	const capture: AnalyticsPluginOptions['capture'] = {
		slots: {
			global: globalPosthog ? globalPosthog.id : nativeAdapter.id,
			tenant: E2E_SITE_ADAPTER_ID,
		},
		gate: 'all',
		...(profile === 'strict' ? { withoutConsent: 'off' as const } : {}),
		exclusion: { sites: ({ req }) => [devSiteAddress(req)] },
		skip: sharedSkip,
	}
	return {
		collections: [],
		plugins: [
			analytics({
				adapters: globalPosthog ? [nativeAdapter, globalPosthog] : [nativeAdapter],
				defaultAdapter: nativeAdapter.id,
				sync: true,
				reportingTimezone: DEV_REPORTING_TIMEZONE,
				revenue: sharedRevenue,
				collections: { pages: { ...pagesBinding, scopeField: false } },
				capture,
				goals: { defaults: sharedGoals, collection: true },
				providers: { resolve: resolveProviders },
				scope: { resolve: resolveVendorScope, member: signedIn },
				access: {
					crossScope: { named: signedIn, aggregate: signedIn, unscopedSource: signedIn },
				},
				widgets: sharedWidgets,
			}),
		],
		dashboard: { widgets: [], defaultLayout: sharedDashboardLayout },
	}
}
