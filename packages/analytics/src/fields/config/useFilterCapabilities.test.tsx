import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { SourcesResponse, WireSource } from './fetchSources'
import { useFilterCapabilities } from './useFilterCapabilities'

const mocks = vi.hoisted(() => ({
	sourceId: undefined as string | undefined,
	sourcePaths: [] as Array<string | undefined>,
	userId: 'user-0',
}))

vi.mock('@payloadcms/ui', () => ({
	useAuth: () => ({ user: { id: mocks.userId } }),
	useConfig: () => ({
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
	}),
	useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) => {
		// Record the sibling path the hook asks for, and answer with the staged id.
		const fields = new Proxy(
			{},
			{
				get: (_target, prop: string) => {
					mocks.sourcePaths.push(prop)
					return { value: mocks.sourceId }
				},
			}
		) as Record<string, { value: unknown }>
		return selector([fields])
	},
}))

const caps = (over: Partial<SerializedCapabilities> = {}): SerializedCapabilities => ({
	metrics: ['pageviews'],
	dimensions: ['page'],
	filters: ['page'],
	filterOperators: ['eq'],
	realtime: false,
	perPageQuery: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	...over,
})

const source = (id: string, over: Partial<SerializedCapabilities>): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities: caps(over),
})

const fetchMock = vi.fn()

const answer = (body: SourcesResponse) =>
	fetchMock.mockResolvedValue(
		new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
	)

const twoSources: SourcesResponse = {
	defaultId: 'alpha',
	sources: [
		source('alpha', { filters: ['page', 'country'], filterOperators: ['eq'] }),
		source('beta', { filters: ['referrer'], filterOperators: ['eq', 'contains', 'matches'] }),
	],
}

let userSeq = 0

beforeEach(() => {
	userSeq += 1
	// fetchSources caches per user, so each test acts as a different one.
	mocks.userId = `user-${userSeq}`
	mocks.sourceId = undefined
	mocks.sourcePaths.length = 0
	fetchMock.mockReset()
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
	cleanup()
})

describe('useFilterCapabilities', () => {
	it('reports loading with nothing offered until the sources answer', () => {
		answer(twoSources)

		const { result } = renderHook(() => useFilterCapabilities())

		expect(result.current.loading).toBe(true)
		expect(result.current.error).toBe(false)
		expect(result.current.dimensions).toEqual([])
		expect(result.current.operators).toEqual([])
	})

	it('unions every source when no data source is chosen', async () => {
		answer(twoSources)

		const { result } = renderHook(() => useFilterCapabilities())

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.dimensions).toEqual(['page', 'referrer', 'country'])
		expect(result.current.operators).toEqual(['eq', 'contains', 'matches'])
	})

	it('narrows to the chosen source', async () => {
		answer(twoSources)
		mocks.sourceId = 'beta'

		const { result } = renderHook(() => useFilterCapabilities())

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.dimensions).toEqual(['referrer'])
		expect(result.current.operators).toEqual(['eq', 'contains', 'matches'])
	})

	it('offers nothing for a source that cannot filter at all', async () => {
		answer({
			defaultId: 'flat',
			sources: [source('flat', { filters: [], filterOperators: [] })],
		})
		mocks.sourceId = 'flat'

		const { result } = renderHook(() => useFilterCapabilities())

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.dimensions).toEqual([])
		expect(result.current.operators).toEqual([])
	})

	it('falls back to the union for a source id the endpoint did not list', async () => {
		answer(twoSources)
		mocks.sourceId = 'gone'

		const { result } = renderHook(() => useFilterCapabilities())

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.dimensions).toEqual(['page', 'referrer', 'country'])
	})

	it('reports the failed fetch rather than an empty source', async () => {
		fetchMock.mockRejectedValue(new Error('offline'))

		const { result } = renderHook(() => useFilterCapabilities())

		await waitFor(() => expect(result.current.error).toBe(true))
		expect(result.current.loading).toBe(false)
		expect(result.current.dimensions).toEqual([])
	})

	it('reads the sibling data source field, and a caller-named one', async () => {
		answer(twoSources)

		renderHook(() => useFilterCapabilities())
		await waitFor(() => expect(mocks.sourcePaths).toContain('dataSource'))

		renderHook(() => useFilterCapabilities('blocks.0.source'))
		await waitFor(() => expect(mocks.sourcePaths).toContain('blocks.0.source'))
	})

	it('orders dimensions by the contract, not by source order', async () => {
		answer({
			defaultId: 'z',
			sources: [source('z', { filters: ['country', 'page', 'browser'] })],
		})
		mocks.sourceId = 'z'

		const { result } = renderHook(() => useFilterCapabilities())

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.dimensions).toEqual(['page', 'browser', 'country'])
	})
})
