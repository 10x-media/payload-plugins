import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { AnalyticsResult } from '../../core/contract'
import type { QueryResponse, SerializedAnalyticsQuery } from '../../query/response'
import { keys } from '../../translations/keys'
import type { QueryState } from '../useViewQueries'
import { GoalsPanel } from './GoalsPanel'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const capabilities = {} as unknown as SerializedCapabilities

const query = (goalSlugs?: SerializedAnalyticsQuery['goalSlugs']): SerializedAnalyticsQuery => ({
	metrics: ['conversions'],
	dimensions: ['goal'],
	dateRange: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
	...(goalSlugs === undefined ? {} : { goalSlugs }),
})

const answer = (over: {
	result?: AnalyticsResult
	goalSlugs?: SerializedAnalyticsQuery['goalSlugs']
}): QueryResponse => ({
	result: over.result ?? {
		rows: [],
		meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' },
	},
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities,
	query: query(over.goalSlugs),
})

const state = (data: QueryResponse): QueryState<QueryResponse> => ({
	status: 'ok',
	isRefetching: false,
	refetch: () => {},
	data,
})

const renderPanel = (data: QueryResponse) =>
	render(<GoalsPanel goals={[]} locale="en" query={state(data)} />)

afterEach(() => {
	cleanup()
})

describe('GoalsPanel empty states', () => {
	it('says the scope configures no goals when the read was hinted an empty list', () => {
		renderPanel(answer({ goalSlugs: [] }))
		expect(screen.getByText(keys.stateNoGoals)).toBeDefined()
	})

	it('keeps the plain empty state when the scope has goals and none converted', () => {
		renderPanel(answer({ goalSlugs: ['signup'] }))
		expect(screen.getByText(keys.stateNoBreakdown)).toBeDefined()
	})

	it('keeps saying the source could not answer when the resolver failed', () => {
		renderPanel(
			answer({
				goalSlugs: 'unresolved',
				result: {
					rows: [],
					meta: {
						provider: 'native',
						fetchedAt: '2026-09-14T00:00:00.000Z',
						goalsUnresolved: true,
					},
				},
			})
		)
		expect(screen.getByText(keys.stateGoalsUnresolved)).toBeDefined()
	})
})
