import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import type { AnalyticsResult, MetricValues } from '../core/contract'
import type { QueryResponse } from '../query/response'
import { keys } from '../translations/keys'
import { withoutConsentShare } from './consentShare'
import { OverviewCards } from './sections/OverviewCards'

vi.mock('@payloadcms/ui', () => ({
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, unknown>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
}))

afterEach(() => {
	cleanup()
})

const result = (
	totals: MetricValues | undefined,
	meta: Partial<AnalyticsResult['meta']> = {}
): AnalyticsResult => ({
	rows: [],
	...(totals ? { totals } : {}),
	meta: { provider: 'posthog', fetchedAt: '2026-10-16T00:00:00.000Z', ...meta },
})

describe('withoutConsentShare', () => {
	it('divides the pageviews counted without consent by all pageviews', () => {
		expect(
			withoutConsentShare(result({ pageviews: 1000 }, { withoutConsent: { pageviews: 380 } }))
		).toBe(0.38)
	})

	it('is nothing when the source reports none, or there is no total to divide by', () => {
		expect(withoutConsentShare(result({ pageviews: 1000 }))).toBeUndefined()
		expect(
			withoutConsentShare(result({ pageviews: 1000 }, { withoutConsent: { pageviews: 0 } }))
		).toBeUndefined()
		expect(
			withoutConsentShare(result({ visitors: 10 }, { withoutConsent: { pageviews: 3 } }))
		).toBeUndefined()
		expect(
			withoutConsentShare(result({ pageviews: 0 }, { withoutConsent: { pageviews: 3 } }))
		).toBeUndefined()
		expect(withoutConsentShare(undefined)).toBeUndefined()
	})

	it('never reads above a whole', () => {
		expect(
			withoutConsentShare(result({ pageviews: 10 }, { withoutConsent: { pageviews: 12 } }))
		).toBe(1)
	})
})

describe('OverviewCards share counted without consent', () => {
	const capabilities = {
		metrics: ['pageviews', 'visitors'],
		dimensions: [],
		filters: {},
	} as unknown as SerializedCapabilities

	const renderWith = (answer: AnalyticsResult) =>
		render(
			<OverviewCards
				compare={false}
				locale="en"
				metrics={['pageviews', 'visitors']}
				onSelect={() => {}}
				query={{
					status: 'ok',
					isRefetching: false,
					refetch: () => {},
					data: {
						result: answer,
						source: { id: 'posthog', label: 'PostHog', kind: 'config' },
						capabilities,
						query: {
							metrics: ['pageviews', 'visitors'],
							dateRange: { start: '2026-09-16T00:00:00.000Z', end: '2026-10-16T00:00:00.000Z' },
						},
					} satisfies QueryResponse,
				}}
				selected="pageviews"
			/>
		)

	it('says what share of the range’s pageviews was counted without consent', () => {
		renderWith(result({ pageviews: 1000, visitors: 400 }, { withoutConsent: { pageviews: 380 } }))
		expect(
			screen.getByText(`${keys.viewWithoutConsentShare} ${JSON.stringify({ share: '38%' })}`)
		).toBeDefined()
	})

	it('says nothing when the source reports no such pageviews', () => {
		const { container } = renderWith(result({ pageviews: 1000, visitors: 400 }))
		expect(container.textContent).not.toContain(keys.viewWithoutConsentShare)
	})
})
