/**
 * What the vendor e2e mode and its Playwright specs agree on. Imports nothing, so a spec reads it
 * without loading the plugin or Payload.
 */

/**
 * The vendor configurations `ANALYTICS_E2E_VENDORS` boots, one server each. `cookieless`: the
 * default `capture.withoutConsent`; `strict`: `'off'`; `anonymous`: `native({ withoutConsent:
 * 'anonymous' })`; `pair`: a PostHog client in each slot.
 */
export const E2E_VENDOR_PROFILES = ['cookieless', 'strict', 'anonymous', 'pair'] as const

export type E2eVendorProfile = (typeof E2E_VENDOR_PROFILES)[number]

/**
 * The sites whose host label (`plausible.localhost`) puts that vendor in the tenant slot. The
 * plain `localhost` site has the global slot alone.
 */
export const E2E_VENDOR_SITES = ['plausible', 'umami', 'posthog', 'ga4'] as const

export type E2eVendorSite = (typeof E2E_VENDOR_SITES)[number]

/** The scope of the plain `localhost` site, which has no tenant-slot vendor. */
export const E2E_PLAIN_SITE_SCOPE = 'site'

/** The id every tenant-slot adapter carries, so `capture.slots.tenant` names one id for all sites. */
export const E2E_SITE_ADAPTER_ID = 'e2e-site'

/** The base path each vendor is served under on the mock upstream. */
export const E2E_UPSTREAM_BASES = {
	plausible: '/plausible',
	umami: '/umami',
	posthogGlobal: '/posthog-global',
	posthogTenant: '/posthog-tenant',
} as const

/** PostHog's public project tokens, one per client, so each client's storage keys are its own. */
export const E2E_POSTHOG_TOKENS = {
	global: 'phc_e2eGlobalToken',
	tenant: 'phc_e2eTenantToken',
} as const

export const E2E_PLAUSIBLE_DOMAIN = 'e2e.example.com'

export const E2E_UMAMI_WEBSITE_ID = '00000000-0000-4000-8000-0000000000e2'

export const E2E_GA4_MEASUREMENT_ID = 'G-E2ETEST000'

/** The profile `ANALYTICS_E2E_VENDORS` names, or undefined when the mode is off. */
export const e2eVendorProfile = (value: string | undefined): E2eVendorProfile | undefined =>
	E2E_VENDOR_PROFILES.find((profile) => profile === value)

/** The vendor site a host names by its first label, if any. */
export const e2eVendorSite = (host: string | null | undefined): E2eVendorSite | undefined => {
	const label = host?.split(':')[0]?.split('.')[0]
	return E2E_VENDOR_SITES.find((site) => site === label && host?.includes('.'))
}
