import { describe, expect, it } from 'vitest'
import { isNewDocumentAnalytics } from './emptyState'

describe('isNewDocumentAnalytics', () => {
	it('is new when no path resolved (an unsaved or unbound document)', () => {
		expect(isNewDocumentAnalytics({ status: 'no-path', metrics: {}, supportedMetrics: [] })).toBe(
			true
		)
	})

	it('is new when the document is bound but has no data in any tracked metric', () => {
		expect(
			isNewDocumentAnalytics({
				status: 'ok',
				metrics: { pageviews: 0, visitors: 0 },
				supportedMetrics: ['pageviews', 'visitors'],
			})
		).toBe(true)
	})

	it('is new when a tracked metric total is missing entirely', () => {
		expect(
			isNewDocumentAnalytics({
				status: 'ok',
				metrics: {},
				supportedMetrics: ['pageviews'],
			})
		).toBe(true)
	})

	it('is not new once any tracked metric has data', () => {
		expect(
			isNewDocumentAnalytics({
				status: 'ok',
				metrics: { pageviews: 3, visitors: 0 },
				supportedMetrics: ['pageviews', 'visitors'],
			})
		).toBe(false)
	})

	it('is not new for a configuration state (that is a message, not a new page)', () => {
		for (const status of ['not-bound', 'not-configured', 'unavailable'] as const) {
			expect(isNewDocumentAnalytics({ status, metrics: {}, supportedMetrics: [] })).toBe(false)
		}
	})
})
