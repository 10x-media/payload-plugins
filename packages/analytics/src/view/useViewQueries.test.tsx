import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import type { QueryRequest } from '../query/fetchQuery'
import { QueryFetchError } from '../query/fetchQuery'
import type { QueryResponse } from '../query/response'
import { VIEW_METRIC_ORDER } from './gating'
import { DEFAULT_VIEW_LIMIT, rangeFor, type ViewState } from './state'
import { useViewQueries, type ViewQueries } from './useViewQueries'
import type { AnalyticsViewClientProps } from './viewProps'

const { fetchQueryMock } = vi.hoisted(() => ({
	fetchQueryMock:
		vi.fn<(apiRoute: string, request: QueryRequest, init?: { signal?: AbortSignal }) => unknown>(),
}))

vi.mock('../query/fetchQuery', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../query/fetchQuery')>()
	return { ...actual, fetchQuery: fetchQueryMock }
})

const nativeCaps: SerializedCapabilities = {
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: [...DIMENSION_KEYS],
	filterOperators: [...FILTER_OPERATORS],
	realtime: true,
	perPageQuery: true,
	comparison: true,
	minGranularity: 'minute',
	maxLookbackDays: null,
}

const narrowCaps: SerializedCapabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page'],
	filters: [],
	filterOperators: [],
	realtime: false,
	perPageQuery: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: 90,
}

const propsFor = (capabilities: SerializedCapabilities): AnalyticsViewClientProps => ({
	sources: {
		defaultId: 'native',
		sources: [{ id: 'native', label: 'Native', kind: 'config', capabilities }],
	},
	goals: [{ slug: 'signup', name: 'Signup' }],
	defaults: { range: 'last30days', metric: 'pageviews' },
	apiRoute: '/api',
	adminRoute: '/admin',
	timezone: 'Europe/Berlin',
	locale: 'en',
})

const baseState: ViewState = {
	range: 'last30days',
	compare: false,
	metric: 'pageviews',
	tab: 'pages',
	filters: [],
	limit: DEFAULT_VIEW_LIMIT,
}

let latest: ViewQueries | null = null

const Probe = ({ props, state }: { props: AnalyticsViewClientProps; state: ViewState }) => {
	latest = useViewQueries(props, state)
	return null
}

const requests = (): QueryRequest[] => fetchQueryMock.mock.calls.map((call) => call[1])

const signals = (): AbortSignal[] =>
	fetchQueryMock.mock.calls.map((call) => {
		const signal = call[2]?.signal
		if (!signal) throw new Error('fetchQuery was called without an abort signal')
		return signal
	})

const response = (): QueryResponse => ({
	result: { rows: [], meta: { provider: 'native', fetchedAt: '2026-03-01T00:00:00.000Z' } },
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities: nativeCaps,
	query: {
		metrics: ['pageviews'],
		dateRange: { start: '2026-02-01T00:00:00.000Z', end: '2026-03-01T00:00:00.000Z' },
	},
})

const dayWindow = (state: ViewState = baseState) => rangeFor(state, 'Europe/Berlin', new Date())

beforeEach(() => {
	latest = null
	fetchQueryMock.mockReset()
	fetchQueryMock.mockImplementation(() => new Promise(() => {}))
})

afterEach(() => {
	cleanup()
})

describe('useViewQueries', () => {
	it('builds the four requests a full source serves', () => {
		render(<Probe props={propsFor(nativeCaps)} state={baseState} />)
		const { from, to } = dayWindow()
		const shared = { from, to, source: 'native', timezone: 'Europe/Berlin' }
		expect(requests()).toEqual([
			{ metrics: VIEW_METRIC_ORDER, ...shared },
			{ metrics: ['pageviews'], ...shared, granularity: 'day' },
			{
				metrics: ['pageviews', 'visitors'],
				dimensions: ['page'],
				...shared,
				limit: DEFAULT_VIEW_LIMIT,
				order: { metric: 'pageviews', direction: 'desc' },
			},
			{ metrics: ['conversions', 'revenue', 'visitors'], dimensions: ['goal'], ...shared },
		])
		expect(latest?.goals).not.toBeNull()
	})

	it('asks for the comparison window only when the state and the source both allow it', () => {
		render(<Probe props={propsFor(nativeCaps)} state={{ ...baseState, compare: true }} />)
		expect(requests()[0]?.compare).toBe('previous')
		expect(requests()[1]?.compare).toBe('previous')
		expect(requests()[2]?.compare).toBeUndefined()
		cleanup()

		fetchQueryMock.mockClear()
		render(<Probe props={propsFor(narrowCaps)} state={{ ...baseState, compare: true }} />)
		expect(requests().every((request) => request.compare === undefined)).toBe(true)
	})

	it('omits the goals request when the source serves no goal breakdown', () => {
		render(<Probe props={propsFor(narrowCaps)} state={baseState} />)
		expect(fetchQueryMock).toHaveBeenCalledTimes(3)
		expect(latest?.goals).toBeNull()
	})

	it('never requests a metric, dimension, filter or granularity the gate forbids', () => {
		render(
			<Probe
				props={propsFor(narrowCaps)}
				state={{
					...baseState,
					metric: 'revenue',
					tab: 'geography',
					granularity: 'hour',
					filters: [{ dimension: 'page', operator: 'eq', value: '/docs' }],
					order: { metric: 'revenue', direction: 'asc' },
				}}
			/>
		)
		const [cards, trend, breakdown] = requests()
		expect(cards?.metrics).toEqual(['pageviews', 'visitors'])
		expect(cards?.filters).toBeUndefined()
		expect(trend?.metrics).toEqual(['pageviews'])
		expect(trend?.granularity).toBe('day')
		expect(breakdown?.dimensions).toEqual(['page'])
		expect(breakdown?.order).toEqual({ metric: 'pageviews', direction: 'desc' })
	})

	it('carries the resolved source and the active filters into every request', () => {
		render(
			<Probe
				props={propsFor(nativeCaps)}
				state={{
					...baseState,
					source: 'native',
					filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
				}}
			/>
		)
		for (const request of requests()) {
			expect(request.source).toBe('native')
			expect(request.filters).toEqual([{ dimension: 'country', operator: 'eq', value: 'DE' }])
		}
	})

	it('asks for the source it resolved, not a stale one the URL still names', () => {
		render(<Probe props={propsFor(nativeCaps)} state={{ ...baseState, source: 'retired' }} />)
		expect(requests().every((request) => request.source === 'native')).toBe(true)
	})

	it('aborts a section whose request changed, and issues the new one', () => {
		const { rerender } = render(<Probe props={propsFor(nativeCaps)} state={baseState} />)
		const before = signals()
		expect(before.some((signal) => signal.aborted)).toBe(false)

		rerender(<Probe props={propsFor(nativeCaps)} state={{ ...baseState, metric: 'visitors' }} />)
		// The cards ask for every served metric, so only the trend and the breakdown move.
		expect(before[0]?.aborted).toBe(false)
		expect(before[1]?.aborted).toBe(true)
		expect(before[2]?.aborted).toBe(true)
		// The breakdown drops its second metric: the selected one is already `visitors`.
		const reissued = requests().slice(before.length)
		expect(reissued.map((request) => request.metrics)).toEqual([['visitors'], ['visitors']])
	})

	it('aborts every section when the filters change', () => {
		const { rerender } = render(<Probe props={propsFor(nativeCaps)} state={baseState} />)
		const before = signals()
		rerender(
			<Probe
				props={propsFor(nativeCaps)}
				state={{ ...baseState, filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }] }}
			/>
		)
		expect(before.every((signal) => signal.aborted)).toBe(true)
		expect(fetchQueryMock).toHaveBeenCalledTimes(before.length * 2)
	})

	it('leaves a request that did not change alone when another section moves', () => {
		const { rerender } = render(<Probe props={propsFor(nativeCaps)} state={baseState} />)
		const cardsSignal = signals()[0]
		rerender(<Probe props={propsFor(nativeCaps)} state={{ ...baseState, limit: 50 }} />)
		expect(cardsSignal?.aborted).toBe(false)
	})

	it('reports ok with the endpoint payload', async () => {
		const payload = response()
		fetchQueryMock.mockImplementation(() => Promise.resolve(payload))
		render(<Probe props={propsFor(nativeCaps)} state={baseState} />)
		await act(async () => {})
		expect(latest?.cards.status).toBe('ok')
		expect(latest?.cards.data).toBe(payload)
	})

	it('surfaces the endpoint error, and retries on refetch', async () => {
		const failure = new QueryFetchError(
			503,
			{ code: 'unavailable', message: 'source is unavailable' },
			30
		)
		fetchQueryMock.mockImplementation(() => Promise.reject(failure))
		render(<Probe props={propsFor(nativeCaps)} state={baseState} />)
		await act(async () => {})
		expect(latest?.cards.status).toBe('error')
		const error = latest?.cards.error
		expect(error).toBeInstanceOf(QueryFetchError)
		expect((error as QueryFetchError).status).toBe(503)
		expect((error as QueryFetchError).error?.code).toBe('unavailable')
		expect((error as QueryFetchError).retryAfter).toBe(30)

		const payload = response()
		fetchQueryMock.mockImplementation(() => Promise.resolve(payload))
		const refetch = latest?.cards.refetch
		await act(async () => {
			refetch?.()
		})
		expect(latest?.cards.status).toBe('ok')
	})

	it('reports an error for a scope with no readable source', () => {
		const props = propsFor(nativeCaps)
		render(
			<Probe props={{ ...props, sources: { defaultId: null, sources: [] } }} state={baseState} />
		)
		expect(fetchQueryMock).not.toHaveBeenCalled()
		expect(latest?.cards.status).toBe('error')
		expect(latest?.goals).toBeNull()
	})
})
