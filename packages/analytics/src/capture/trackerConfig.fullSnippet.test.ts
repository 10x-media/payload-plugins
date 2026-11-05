import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { resolveTrackerConfig } from './trackerConfig'

/** The variant a server-known grant renders for a slot counting without consent. */

const req = {
	payload: { config: { routes: { api: '/api' } }, logger: { warn: vi.fn() } },
} as unknown as PayloadRequest

const slotOf = async (adapter: AnalyticsAdapter, partial: Partial<AnalyticsRuntime> = {}) => {
	const runtime: AnalyticsRuntime = {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		engine: {} as AnalyticsRuntime['engine'],
		ttl: {},
		comparison: true,
		captureGate: () => true,
		...partial,
	}
	const config = await resolveTrackerConfig({ runtime, req })
	return config.slots[0]
}

const inline = (snippet: { scripts: Array<{ inline?: string }> } | undefined) =>
	snippet?.scripts.map((script) => script.inline ?? '').join('')

describe('the full snippet variant', () => {
	it('starts PostHog without its default opt-out, and switchable', async () => {
		const slot = await slotOf(
			posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' })
		)
		expect(inline(slot?.snippet)).toContain('opt_out_capturing_by_default:true')
		expect(inline(slot?.fullSnippet)).toContain('cookieless_mode:"on_reject"')
		expect(inline(slot?.fullSnippet)).not.toContain('opt_out_capturing_by_default')
	})

	it('starts GA4 with analytics storage granted and the exclusion guard, advertising denied', async () => {
		const slot = await slotOf(
			ga4({
				propertyId: '1',
				credentials: { client_email: 'sa@x.iam', private_key: 'pk' },
				measurementId: 'G-AB12CD34',
				withoutConsent: 'cookieless',
			})
		)
		const full = inline(slot?.fullSnippet) ?? ''
		expect(full).toContain('localStorage.getItem("analytics:exclude")')
		expect(full).toContain(
			'gtag("consent","default",{analytics_storage:"granted",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"})'
		)
		expect(inline(slot?.snippet)).toContain('analytics_storage:"denied"')
		expect(inline(slot?.snippet)).not.toContain('localStorage')
	})

	it('is left out where it would equal the snippet, and for a slot sending nothing without consent', async () => {
		const inherent = await slotOf(plausible({ siteId: 'e.com', apiKey: 'k', domain: 'e.com' }))
		expect(inherent?.withoutConsent).toBeDefined()
		expect(inherent?.fullSnippet).toBeUndefined()

		const strict = await slotOf(
			ga4({
				propertyId: '1',
				credentials: { client_email: 'sa@x.iam', private_key: 'pk' },
				measurementId: 'G-AB12CD34',
			})
		)
		expect(strict?.withoutConsent).toBeUndefined()
		expect(strict?.fullSnippet).toBeUndefined()
	})
})
