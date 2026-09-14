import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import type { QueryRequest } from '../query/fetchQuery'
import type { QueryResponse } from '../query/response'
import { keys } from '../translations/keys'
import { METRIC_KEYS } from '../translations/metricKeys'
import { AnalyticsViewClient } from './AnalyticsViewClient'
import { VIEW_METRIC_ORDER } from './gating'
import type { AnalyticsViewClientProps } from './viewProps'

const mocks = vi.hoisted(() => ({
	search: '',
	replace: vi.fn<(url: string) => void>(),
	fetchQueryMock: vi.fn<(apiRoute: string, request: QueryRequest) => Promise<unknown>>(),
}))

vi.mock('next/navigation', () => ({
	usePathname: () => '/admin/analytics',
	useRouter: () => ({ replace: mocks.replace }),
	useSearchParams: () => new URLSearchParams(mocks.search),
}))

vi.mock('../query/fetchQuery', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../query/fetchQuery')>()
	return { ...actual, fetchQuery: mocks.fetchQueryMock }
})

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({
		children,
		onClick,
		extraButtonProps,
	}: {
		children?: ReactNode
		onClick?: () => void
		extraButtonProps?: Record<string, unknown>
	}) => (
		<button onClick={onClick} {...extraButtonProps}>
			{children}
		</button>
	),
	Pill: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
	SelectInput: ({
		label,
		options,
		value,
		onChange,
	}: {
		label?: string
		options?: { value: string; label: string }[]
		value?: string
		onChange?: (option: { value: string; label: string }) => void
	}) => (
		<select
			aria-label={String(label)}
			onChange={(event) => onChange?.({ value: event.target.value, label: event.target.value })}
			value={value}
		>
			{(options ?? []).map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
	XIcon: () => <span aria-hidden="true" />,
}))

const nativeCaps: SerializedCapabilities = {
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: [...DIMENSION_KEYS],
	filterOperators: [...FILTER_OPERATORS],
	realtime: false,
	perPageQuery: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
}

const props = (overrides: Partial<AnalyticsViewClientProps> = {}): AnalyticsViewClientProps => ({
	sources: {
		defaultId: 'native',
		sources: [{ id: 'native', label: 'Native', kind: 'config', capabilities: nativeCaps }],
	},
	goals: [{ slug: 'signup', name: 'Signup' }],
	defaults: { range: 'last30days', metric: 'pageviews' },
	apiRoute: '/api',
	adminRoute: '/admin',
	timezone: 'Europe/Berlin',
	locale: 'en',
	...overrides,
})

const answer = (request: QueryRequest, stale = false): QueryResponse => ({
	result: {
		rows:
			request.dimensions === undefined
				? [{ timestamp: '2026-09-13T00:00:00.000Z', metrics: { pageviews: 42 } }]
				: [
						{ dimensions: { page: '/pricing' }, metrics: { pageviews: 120, visitors: 90 } },
						{ dimensions: { page: '/about' }, metrics: { pageviews: 60, visitors: 40 } },
					],
		totals: { pageviews: 1234, visitors: 400 },
		meta: {
			provider: 'native',
			fetchedAt: '2026-09-14T00:00:00.000Z',
			...(stale ? { stale } : {}),
		},
	},
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities: nativeCaps,
	query: {
		metrics: request.metrics,
		dateRange: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
	},
})

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(() => {
	mocks.search = ''
	mocks.replace.mockReset()
	mocks.fetchQueryMock.mockReset()
	mocks.fetchQueryMock.mockImplementation((_route, request) => Promise.resolve(answer(request)))
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
	)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const renderView = async (overrides: Partial<AnalyticsViewClientProps> = {}) => {
	const result = render(<AnalyticsViewClient {...props(overrides)} />)
	await act(async () => {})
	return result
}

describe('AnalyticsViewClient', () => {
	it('renders the title, the overview totals and the breakdown rows', async () => {
		await renderView()
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(keys.viewTitle)
		expect(screen.getByText('1,234')).toBeDefined()
		expect(screen.getByRole('button', { name: /\/pricing/ })).toBeDefined()
	})

	it('shows the no-sources empty state instead of any section', async () => {
		await renderView({ sources: { defaultId: null, sources: [] } })
		expect(screen.getByText(keys.viewNoSources)).toBeDefined()
		expect(screen.queryByRole('tablist')).toBeNull()
	})

	it('writes the charted metric to the URL when a card is clicked', async () => {
		await renderView()
		const cards = within(screen.getByRole('group', { name: keys.viewOverview }))
		fireEvent.click(cards.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(mocks.replace).toHaveBeenCalledWith('/admin/analytics?metric=visitors', {
			scroll: false,
		})
	})

	it('adds an eq filter chip and rewrites the URL when a breakdown row is clicked', async () => {
		const { rerender } = await renderView()
		fireEvent.click(screen.getByRole('button', { name: /\/pricing/ }))
		const url = mocks.replace.mock.calls[0]?.[0] as string
		expect(url).toContain('filters=')
		const written = new URLSearchParams(url.slice(url.indexOf('?') + 1))
		expect(JSON.parse(String(written.get('filters')))).toEqual([
			{ dimension: 'page', operator: 'eq', value: '/pricing' },
		])

		mocks.search = written.toString()
		rerender(<AnalyticsViewClient {...props()} />)
		await act(async () => {})
		expect(screen.getAllByText(/\/pricing/).length).toBeGreaterThan(1)
		const filtered = mocks.fetchQueryMock.mock.calls.at(-1)?.[1]
		expect(filtered?.filters).toEqual([{ dimension: 'page', operator: 'eq', value: '/pricing' }])
	})

	it('badges a read served from an expired cache', async () => {
		mocks.fetchQueryMock.mockImplementation((_route, request) =>
			Promise.resolve(answer(request, true))
		)
		await renderView()
		expect(screen.getByText(keys.viewStale)).toBeDefined()
	})

	it('leaves the badge off a fresh read', async () => {
		await renderView()
		expect(screen.queryByText(keys.viewStale)).toBeNull()
	})

	it('surfaces a failed section with a retry that reissues the read', async () => {
		mocks.fetchQueryMock.mockImplementation(() => Promise.reject(new Error('network down')))
		await renderView()
		const failures = screen.getAllByText(keys.viewErrorGeneric)
		expect(failures.length).toBeGreaterThan(0)
		const before = mocks.fetchQueryMock.mock.calls.length
		await act(async () => {
			fireEvent.click(screen.getAllByText(keys.viewRetry)[0] as HTMLElement)
		})
		expect(mocks.fetchQueryMock.mock.calls.length).toBeGreaterThan(before)
	})

	it('reads the URL for the state it renders', async () => {
		mocks.search = 'tab=geography&metric=visitors&limit=25'
		await renderView()
		const breakdown = mocks.fetchQueryMock.mock.calls
			.map((call) => call[1])
			.find((request) => request.dimensions !== undefined)
		expect(breakdown?.dimensions).toEqual(['country'])
		expect(breakdown?.limit).toBe(25)
	})
})
