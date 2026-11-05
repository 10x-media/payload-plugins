import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../../core/contract'
import type { FetchQueryInit, QueryRequest } from '../../query/fetchQuery'
import type { QueryResponse } from '../../query/response'
import { VIEW_METRIC_ORDER } from '../../view/gating'
import type { WireSource } from './fetchSources'
import {
	fetchFilterValues,
	SUGGESTION_DAYS,
	SUGGESTION_LIMIT,
	suggestionMetric,
	suggestionRange,
} from './filterValues'

const { fetchQueryMock } = vi.hoisted(() => ({
	fetchQueryMock:
		vi.fn<
			(endpoint: string, request: QueryRequest, init?: FetchQueryInit) => Promise<QueryResponse>
		>(),
}))

vi.mock('../../query/fetchQuery', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../query/fetchQuery')>()
	return { ...actual, fetchQuery: fetchQueryMock }
})

const caps = (over: Partial<SerializedCapabilities> = {}): SerializedCapabilities => ({
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: Object.fromEntries(
		DIMENSION_KEYS.map((dimension) => [dimension, [...FILTER_OPERATORS]])
	),
	realtime: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
	...over,
})

const sourceOf = (id: string, over: Partial<SerializedCapabilities> = {}): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities: caps(over),
})

const answer = (values: string[], dimension = 'page'): QueryResponse =>
	({
		result: {
			rows: values.map((value) => ({ dimensions: { [dimension]: value }, metrics: {} })),
			meta: { provider: 'native', fetchedAt: '2026-09-21T00:00:00.000Z' },
		},
	}) as unknown as QueryResponse

// The module's cache lives for the life of the admin session and is keyed by api route,
// so each test reads through a route of its own rather than resetting module state.
let routeCounter = 0
const route = (): string => `/api-${++routeCounter}/_x/query`

beforeEach(() => {
	fetchQueryMock.mockReset()
})

describe('suggestionMetric', () => {
	it('ranks a dimension by the metric it has, never by pageviews it has none of', () => {
		expect(suggestionMetric({ dimension: 'event', source: sourceOf('native') })).toBe('events')
		expect(suggestionMetric({ dimension: 'goal', source: sourceOf('native') })).toBe('conversions')
	})

	it('never falls through to pageviews for an event or a goal', () => {
		// A source serving pageviews and nothing else can rank neither, and saying so is what
		// leaves the field a plain text input instead of a list ranked by a structural zero.
		const pageviewsOnly = sourceOf('thin', { metrics: ['pageviews'] })
		expect(suggestionMetric({ dimension: 'event', source: pageviewsOnly })).toBeNull()
		expect(suggestionMetric({ dimension: 'goal', source: pageviewsOnly })).toBeNull()
		expect(suggestionMetric({ dimension: 'page', source: pageviewsOnly })).toBe('pageviews')
	})

	it('ranks every other dimension by visitors, then pageviews, then events', () => {
		expect(suggestionMetric({ dimension: 'page', source: sourceOf('native') })).toBe('visitors')
		const noVisitors = sourceOf('thin', { metrics: ['pageviews', 'events'] })
		expect(suggestionMetric({ dimension: 'country', source: noVisitors })).toBe('pageviews')
		const eventsOnly = sourceOf('thin', { metrics: ['events'] })
		expect(suggestionMetric({ dimension: 'country', source: eventsOnly })).toBe('events')
	})

	it('answers null for a dimension the source cannot group by', () => {
		const noGoals = sourceOf('thin', { dimensions: ['page'] })
		expect(suggestionMetric({ dimension: 'goal', source: noGoals })).toBeNull()
		expect(suggestionMetric({ dimension: 'country', source: noGoals })).toBeNull()
	})

	it('answers null for a source that serves no metric the dimension can use', () => {
		expect(suggestionMetric({ dimension: 'page', source: sourceOf('thin', { metrics: [] }) })).toBe(
			null
		)
	})

	it('offers the dimension its own first column while no source is chosen', () => {
		// Nothing is known about what will answer, so the pick is optimistic and the fetch
		// degrades on its own if the source cannot serve it.
		expect(suggestionMetric({ dimension: 'event' })).toBe('events')
		expect(suggestionMetric({ dimension: 'page' })).toBe('visitors')
	})
})

describe('suggestionRange', () => {
	it('reads the last month up to and including today', () => {
		const range = suggestionRange(new Date('2026-09-21T12:00:00.000Z'))
		expect(range.to).toBe('2026-09-21')
		expect(range.from).toBe('2026-08-23')
		expect(SUGGESTION_DAYS).toBe(30)
	})
})

describe('fetchFilterValues', () => {
	const args = {
		scope: 'user-1#payload-tenant=alpha',
		dimension: 'page',
		metric: 'visitors',
		now: new Date('2026-09-21T00:00:00.000Z'),
	} as const

	it('reads the dimension ranked by the metric, capped at the picker limit', async () => {
		fetchQueryMock.mockResolvedValue(answer(['/pricing', '/about']))
		const endpoint = route()

		await expect(fetchFilterValues({ endpoint, ...args })).resolves.toEqual(['/pricing', '/about'])
		expect(fetchQueryMock).toHaveBeenCalledWith(
			endpoint,
			{
				metrics: ['visitors'],
				dimensions: ['page'],
				from: '2026-08-23',
				to: '2026-09-21',
				limit: SUGGESTION_LIMIT,
				order: { metric: 'visitors', direction: 'desc' },
			},
			{ scope: args.scope }
		)
	})

	it('drops rows the source answered with no value, and duplicates', async () => {
		fetchQueryMock.mockResolvedValue(answer(['/a', '', '   ', '/a', '/b']))
		await expect(fetchFilterValues({ endpoint: route(), ...args })).resolves.toEqual(['/a', '/b'])
	})

	it('caps the list at the picker limit whatever the endpoint returned', async () => {
		const many = Array.from({ length: SUGGESTION_LIMIT + 5 }, (_, i) => `/p${i}`)
		fetchQueryMock.mockResolvedValue(answer(many))
		const values = await fetchFilterValues({ endpoint: route(), ...args })
		expect(values).toHaveLength(SUGGESTION_LIMIT)
	})

	it('reads once per dimension and source, however many fields ask', async () => {
		fetchQueryMock.mockResolvedValue(answer(['/pricing']))
		const endpoint = route()

		const first = fetchFilterValues({ endpoint, ...args, source: 'native' })
		const second = fetchFilterValues({ endpoint, ...args, source: 'native' })

		expect(second).toBe(first)
		await expect(second).resolves.toEqual(['/pricing'])
		expect(fetchQueryMock).toHaveBeenCalledTimes(1)
	})

	it('reads again for another dimension or another source', async () => {
		fetchQueryMock.mockResolvedValue(answer(['/pricing']))
		const endpoint = route()

		await fetchFilterValues({ endpoint, ...args, source: 'native' })
		await fetchFilterValues({ endpoint, ...args, source: 'posthog' })
		await fetchFilterValues({ endpoint, ...args, dimension: 'country', source: 'native' })

		expect(fetchQueryMock).toHaveBeenCalledTimes(3)
	})

	// One tenant's values are not another's, though the request is the same string for both.
	it('reads again for another scope rather than serving the previous tenant its list', async () => {
		fetchQueryMock.mockResolvedValueOnce(answer(['/alpha']))
		fetchQueryMock.mockResolvedValueOnce(answer(['/beta']))
		const endpoint = route()

		await expect(fetchFilterValues({ endpoint, ...args })).resolves.toEqual(['/alpha'])
		await expect(
			fetchFilterValues({ endpoint, ...args, scope: 'user-1#payload-tenant=beta' })
		).resolves.toEqual(['/beta'])
		expect(fetchQueryMock).toHaveBeenCalledTimes(2)
	})

	// A tenant switch while the first tenant's list is still loading: the second read names its
	// own scope, so the shared fetch it would otherwise join is the first tenant's.
	it('reads a switched-to tenant on a fetch of its own while the first is still loading', async () => {
		let settleAlpha: ((value: QueryResponse) => void) | undefined
		fetchQueryMock.mockImplementationOnce(
			() =>
				new Promise<QueryResponse>((resolve) => {
					settleAlpha = resolve
				})
		)
		fetchQueryMock.mockResolvedValueOnce(answer(['/beta']))
		const endpoint = route()

		const alpha = fetchFilterValues({ endpoint, ...args })
		const beta = fetchFilterValues({ endpoint, ...args, scope: 'user-1#payload-tenant=beta' })
		await expect(beta).resolves.toEqual(['/beta'])
		settleAlpha?.(answer(['/alpha']))
		await expect(alpha).resolves.toEqual(['/alpha'])
		expect(fetchQueryMock.mock.calls.map((call) => call[2])).toEqual([
			{ scope: 'user-1#payload-tenant=alpha' },
			{ scope: 'user-1#payload-tenant=beta' },
		])
	})

	it('rejects rather than degrading silently, and lets the next mount try again', async () => {
		const endpoint = route()
		fetchQueryMock.mockRejectedValueOnce(new Error('503'))

		await expect(fetchFilterValues({ endpoint, ...args })).rejects.toThrow('503')

		// The failure is not what the cache keeps: a source that recovers answers next time.
		fetchQueryMock.mockResolvedValue(answer(['/pricing']))
		await expect(fetchFilterValues({ endpoint, ...args })).resolves.toEqual(['/pricing'])
		expect(fetchQueryMock).toHaveBeenCalledTimes(2)
	})

	it('asks the endpoint for the chosen source when there is one', async () => {
		fetchQueryMock.mockResolvedValue(answer([]))
		const endpoint = route()
		await fetchFilterValues({ endpoint, ...args, source: 'posthog' })
		expect(fetchQueryMock.mock.calls[0]?.[1].source).toBe('posthog')
	})
})
