import { describe, expect, it } from 'vitest'
import { cloudAppHost, cloudRegionOf } from './cloud'

describe('cloudRegionOf', () => {
	it.each([
		['US Cloud', 'https://us.posthog.com', 'us'],
		['the older US address', 'https://app.posthog.com', 'us'],
		['EU Cloud', 'https://eu.posthog.com', 'eu'],
		['EU Cloud with a trailing slash', 'https://eu.posthog.com/', 'eu'],
		['EU Cloud in capitals', 'https://EU.PostHog.com', 'eu'],
		['EU Cloud with spaces around it', '  https://eu.posthog.com  ', 'eu'],
		['a self-hosted instance', 'https://ph.example.com', null],
		['a host that only starts like EU Cloud', 'https://eu.posthog.com.example.org', null],
		['an ingest host, not an app host', 'https://eu.i.posthog.com', null],
		['a space inside the address', 'https://eu.posthog .com', null],
		['blank', '', null],
		['only spaces', '   ', null],
	])('%s', (_name, address, region) => {
		expect(cloudRegionOf(address)).toBe(region)
	})

	it("names each region's app host", () => {
		expect(cloudAppHost('us')).toBe('https://us.posthog.com')
		expect(cloudAppHost('eu')).toBe('https://eu.posthog.com')
	})
})
