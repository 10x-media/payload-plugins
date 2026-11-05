import { describe, expect, it } from 'vitest'
import { posthog } from '../adapters/posthog/posthog'
import { CAPTURE_REWRITES_REMOVED, captureRewrites } from './captureRewrites'
import { posthogProxyRewrites } from './posthogProxyRewrites'

// A Next rewrite to a vendor is an http-proxy: it would carry the visitor's cookies upstream.
describe('captureRewrites', () => {
	it('throws, naming the route handler that replaces it', () => {
		const adapter = posthog({ projectId: '', apiKey: '', region: 'eu', projectToken: 'phc_t' })
		expect(() => captureRewrites([{ path: '/ph', adapter }])).toThrow(CAPTURE_REWRITES_REMOVED)
		expect(CAPTURE_REWRITES_REMOVED).toContain('captureRoute')
		expect(CAPTURE_REWRITES_REMOVED).toContain('payload-token')
	})
})

describe('posthogProxyRewrites', () => {
	it('throws as captureRewrites does', () => {
		expect(() => posthogProxyRewrites({ path: '/ph', region: 'us' })).toThrow(
			CAPTURE_REWRITES_REMOVED
		)
	})
})
