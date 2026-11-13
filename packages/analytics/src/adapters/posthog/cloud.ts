import { hostnameOf } from '../http/baseUrl'

/** A PostHog Cloud region. */
export type PosthogRegion = 'us' | 'eu'

/**
 * PostHog Cloud's app hosts and the region each serves: the region's own address, and the older US
 * address `app.posthog.com`. Its own module so the providers collection checks a Host against its
 * Region on the adapter's terms without loading the adapter.
 */
export const POSTHOG_CLOUD_HOSTS: Readonly<Record<string, PosthogRegion>> = {
	'us.posthog.com': 'us',
	'eu.posthog.com': 'eu',
	'app.posthog.com': 'us',
}

/** The cloud region an address belongs to, or null for a self-hosted instance or no address. */
export const cloudRegionOf = (address: string): PosthogRegion | null =>
	POSTHOG_CLOUD_HOSTS[hostnameOf(address)] ?? null

/** Where a region's app and Query API answer. */
export const cloudAppHost = (region: PosthogRegion): string => `https://${region}.posthog.com`
