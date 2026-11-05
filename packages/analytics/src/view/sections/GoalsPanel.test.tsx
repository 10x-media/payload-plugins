import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { AnalyticsResult } from '../../core/contract'
import type { QueryResponse, SerializedAnalyticsQuery } from '../../query/response'
import { declarationsOf } from '../../testing/stylesheet'
import { keys } from '../../translations/keys'
import type { QueryState } from '../useViewQueries'
import type { ViewGoal } from '../viewProps'
import { GoalsPanel } from './GoalsPanel'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	ShimmerEffect: ({ className }: { className?: string }) => (
		<div aria-hidden="true" className={className} />
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

describe('GoalsPanel before the first answer', () => {
	const rem = (value: string | undefined): number => Number.parseFloat(value ?? '')
	const placeholderRows = (goals: ViewGoal[]): number =>
		render(
			<GoalsPanel
				goals={goals}
				locale="en"
				query={{ status: 'loading', isRefetching: false, refetch: () => {} }}
			/>
		).container.querySelectorAll(
			'.analytics-view__skeleton-table--table > .analytics-view__skeleton'
		).length

	// The table lists the scope's goals, so the placeholder stands a row in for each.
	it('holds a row for every goal the scope configures, and one without any', () => {
		const goals = ['signup', 'demo', 'purchase', 'newsletter'].map((slug) => ({ slug, name: slug }))
		expect(placeholderRows(goals)).toBe(4)
		cleanup()
		expect(placeholderRows([])).toBe(1)
	})

	it('spaces its rows at the pitch of a plain table, under a head as tall as its own', () => {
		const plain = declarationsOf('.analytics-view__skeleton-table--table')
		const [top, bottom] = (declarationsOf('.analytics-table thead th')['padding-block'] ?? '')
			.split(' ')
			.map(rem)
		expect(plain['--analytics-skeleton-head']).toBe(
			`calc(1lh + ${(top ?? 0) + (bottom ?? 0)}rem + 1px)`
		)
		const cell = rem(declarationsOf('.analytics-table tbody :is(th, td)')['padding-block'])
		expect(plain['--analytics-skeleton-gap']).toBe(
			`calc(1lh + ${2 * cell}rem + 1px - ${plain['--analytics-skeleton-row']})`
		)
	})
})
