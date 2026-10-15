import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import { type AnalyticsResult, DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import type { QueryRequest } from '../query/fetchQuery'
import type { QueryResponse } from '../query/response'
import { a11yViolations } from '../testing/a11y'
import { keys } from '../translations/keys'
import { METRIC_KEYS } from '../translations/metricKeys'
import { QueryFetchError } from '../ui/data/request'
import { AnalyticsViewClient } from './AnalyticsViewClient'
import { VIEW_METRIC_ORDER } from './gating'
import type { AnalyticsViewClientProps } from './viewProps'

const mocks = vi.hoisted(() => ({
	search: '',
	/** Re-renders whatever reads `useSearchParams`, as Next does when the address changes. */
	listeners: new Set<() => void>(),
	replace: vi.fn<(url: string) => void>(),
	push: vi.fn<(url: string) => void>(),
	fetchQueryMock: vi.fn<(endpoint: string, request: QueryRequest) => Promise<unknown>>(),
	refreshCacheMock: vi.fn<(endpoint: string) => Promise<{ epoch: string }>>(),
}))

/** Moves the address the mocked router reports, and tells every reader. */
const navigate = (search: string): void => {
	mocks.search = search.startsWith('?') ? search.slice(1) : search
	for (const listener of mocks.listeners) {
		listener()
	}
}

vi.mock('next/navigation', async () => {
	const { useSyncExternalStore } = await import('react')
	const subscribe = (listener: () => void) => {
		mocks.listeners.add(listener)
		return () => {
			mocks.listeners.delete(listener)
		}
	}
	return {
		usePathname: () => '/admin/analytics',
		useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
		useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => mocks.search)),
	}
})

vi.mock('../query/fetchQuery', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../query/fetchQuery')>()
	return { ...actual, fetchQuery: mocks.fetchQueryMock, refreshCache: mocks.refreshCacheMock }
})

vi.mock('@payloadcms/ui', async () => ({
	...(await import('../testing/selectMocks')).selectMocks,
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	DatePicker: ({
		onChange,
		overrides,
	}: {
		onChange?: (picked: [Date | null, Date | null]) => void
		overrides?: { id?: string; startDate?: Date | null; endDate?: Date | null }
	}) => {
		const day = (date: Date | null | undefined): string =>
			date
				? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
				: ''
		const date = (value: string | undefined): Date | null => {
			const [year, month, dayOfMonth] = (value ?? '').split('-').map(Number)
			return year && month && dayOfMonth ? new Date(year, month - 1, dayOfMonth) : null
		}
		return (
			<input
				id={overrides?.id}
				onChange={(event) => {
					const [from, to] = event.target.value.split('..')
					onChange?.([date(from), date(to)])
				}}
				value={`${day(overrides?.startDate)}..${day(overrides?.endDate)}`}
			/>
		)
	},
	Button: ({
		children,
		onClick,
		disabled,
		extraButtonProps,
	}: {
		children?: ReactNode
		onClick?: () => void
		disabled?: boolean
		extraButtonProps?: Record<string, unknown>
	}) => (
		<button disabled={disabled} onClick={onClick} {...extraButtonProps}>
			{children}
		</button>
	),
	Pill: ({ children, className }: { children?: ReactNode; className?: string }) => (
		<span className={className}>{children}</span>
	),
	ShimmerEffect: ({ className }: { className?: string }) => (
		<div aria-hidden="true" className={className} />
	),
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
	XIcon: () => <span aria-hidden="true" />,
}))

/** The window the toolbar names, as the language writes a span of days. */
const daysCaption = (): string | null | undefined =>
	document.querySelector('.analytics-view__captions > span')?.textContent

const nativeCaps: SerializedCapabilities = {
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: Object.fromEntries(
		DIMENSION_KEYS.map((dimension) => [dimension, [...FILTER_OPERATORS]])
	),
	realtime: false,
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
	countryFlags: true,
	defaults: { range: 'last30days', metric: 'pageviews' },
	endpoints: { query: '/api/_x/query', refresh: '/api/_x/refresh', live: '/api/_x/live' },
	adminRoute: '/admin',
	timezone: 'Europe/Berlin',
	locale: 'en',
	scopeKey: '',
	...overrides,
})

const answer = (
	request: QueryRequest,
	meta: Partial<AnalyticsResult['meta']> = {}
): QueryResponse => ({
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
			...meta,
		},
	},
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities: nativeCaps,
	query: {
		metrics: request.metrics,
		dateRange: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
	},
})

/** What a source that could not read its goals answers a goal breakdown with. */
const goalsUnresolvedResult: AnalyticsResult = {
	rows: [],
	meta: {
		provider: 'native',
		fetchedAt: '2026-09-14T00:00:00.000Z',
		goalsUnresolved: true,
	},
}

/** Has every goal breakdown answer as a source that could not read its goals. */
const answerGoalsUnresolved = (): void => {
	mocks.fetchQueryMock.mockImplementation((_route, request) =>
		Promise.resolve(
			request.dimensions?.[0] === 'goal'
				? { ...answer(request, { goalsUnresolved: true }), result: goalsUnresolvedResult }
				: answer(request)
		)
	)
}

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const pushed = (): string[] =>
	vi.mocked(window.history.pushState).mock.calls.map((call) => String(call[2]))

const replaced = (): string[] =>
	vi.mocked(window.history.replaceState).mock.calls.map((call) => String(call[2]))

beforeEach(() => {
	mocks.search = ''
	mocks.replace.mockReset()
	mocks.push.mockReset()
	vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
	vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
	mocks.fetchQueryMock.mockReset()
	mocks.fetchQueryMock.mockImplementation((_route, request) => Promise.resolve(answer(request)))
	mocks.refreshCacheMock.mockReset()
	mocks.refreshCacheMock.mockResolvedValue({ epoch: 'tok-1' })
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
	)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const renderView = async (overrides: Partial<AnalyticsViewClientProps> = {}) => {
	const result = render(<AnalyticsViewClient {...props(overrides)} />)
	await act(async () => {})
	return result
}

const clickRefresh = async (): Promise<void> => {
	await act(async () => {
		fireEvent.click(screen.getByRole('button', { name: keys.viewRefresh }))
	})
}

/** Holds every refresh open until the returned call answers it. */
const holdRefresh = (): ((value: { epoch: string }) => void) => {
	let settle: ((value: { epoch: string }) => void) | undefined
	mocks.refreshCacheMock.mockImplementation(
		() =>
			new Promise<{ epoch: string }>((resolve) => {
				settle = resolve
			})
	)
	return (value) => settle?.(value)
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

	it('asks a per-site reader with no site selected to choose one', async () => {
		await renderView({ sources: { defaultId: null, sources: [] }, needsScope: true })
		expect(screen.getByText(keys.stateNoScope)).toBeDefined()
		expect(screen.queryByText(keys.viewNoSources)).toBeNull()
	})

	it("says a tenant is reading the platform's source until it adds its own", async () => {
		const listing = props().sources
		await renderView({ sources: { ...listing, notice: 'platformFallback' } })
		expect(screen.getByText(keys.sourcesPlatformFallback)).toBeDefined()
		expect(screen.getByText('1,234')).toBeDefined()
	})

	it('says nothing about the source for a listing that carries no notice', async () => {
		await renderView()
		expect(screen.queryByText(keys.sourcesPlatformFallback)).toBeNull()
	})

	// A click is a step on the client alone: the router would re-run Payload's whole admin page.
	it('pushes the charted metric to the history when a card is clicked, not through the router', async () => {
		await renderView()
		const cards = within(screen.getByRole('group', { name: keys.viewOverview }))
		fireEvent.click(cards.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(window.history.pushState).toHaveBeenCalledWith(
			null,
			'',
			'/admin/analytics?metric=visitors'
		)
		expect(mocks.push).not.toHaveBeenCalled()
		expect(mocks.replace).not.toHaveBeenCalled()
		expect(window.history.replaceState).not.toHaveBeenCalled()
	})

	it('pushes nothing for picking what is already showing', async () => {
		await renderView()
		const cards = within(screen.getByRole('group', { name: keys.viewOverview }))
		fireEvent.click(cards.getByRole('button', { name: new RegExp(METRIC_KEYS.pageviews) }))
		expect(window.history.pushState).not.toHaveBeenCalled()
	})

	it('adds an eq filter chip and rewrites the URL when a breakdown row is clicked', async () => {
		const { rerender } = await renderView()
		fireEvent.click(screen.getByRole('button', { name: /\/pricing/ }))
		const url = pushed()[0] ?? ''
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

	it('pushes one history entry for a picked range, once both days are picked', async () => {
		mocks.search = 'range=custom&from=2026-06-01&to=2026-06-10'
		await renderView()
		const dates = screen.getByLabelText(keys.viewDates)
		fireEvent.change(dates, { target: { value: '2026-06-05..' } })
		expect(window.history.pushState).not.toHaveBeenCalled()
		fireEvent.change(dates, { target: { value: '2026-06-05..2026-06-08' } })
		expect(window.history.pushState).toHaveBeenCalledTimes(1)
		const url = pushed()[0] ?? ''
		expect(url).toContain('from=2026-06-05')
		expect(url).toContain('to=2026-06-08')
		expect(window.history.replaceState).not.toHaveBeenCalled()
		expect(mocks.push).not.toHaveBeenCalled()
	})

	it('picks a range on top of the state the last click committed', async () => {
		mocks.search = 'range=custom&from=2026-06-01&to=2026-06-10'
		const { rerender } = await renderView()
		const cards = within(screen.getByRole('group', { name: keys.viewOverview }))
		fireEvent.click(cards.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))

		const url = pushed()[0] ?? ''
		expect(url).toContain('metric=visitors')
		mocks.search = url.slice(url.indexOf('?') + 1)
		rerender(<AnalyticsViewClient {...props()} />)
		await act(async () => {})

		fireEvent.change(screen.getByLabelText(keys.viewDates), {
			target: { value: '2026-06-01..2026-06-08' },
		})
		const picked = pushed().at(-1) ?? ''
		expect(picked).toContain('metric=visitors')
		expect(picked).toContain('from=2026-06-01')
		expect(picked).toContain('to=2026-06-08')
	})

	it('badges a read served from an expired cache', async () => {
		mocks.fetchQueryMock.mockImplementation((_route, request) =>
			Promise.resolve(answer(request, { stale: true }))
		)
		await renderView()
		expect(screen.getByText(keys.viewStale)).toBeDefined()
	})

	it('leaves the badge off a fresh read', async () => {
		await renderView()
		expect(screen.queryByText(keys.viewStale)).toBeNull()
		expect(screen.queryByText(keys.stateFiltersUnapplied)).toBeNull()
		expect(screen.queryByText(keys.stateSampled)).toBeNull()
	})

	it('notes a read the source counted from a sample', async () => {
		mocks.fetchQueryMock.mockImplementation((_route, request) =>
			Promise.resolve(answer(request, { sampled: true }))
		)
		await renderView()
		expect(screen.getByText(keys.stateSampled)).toBeDefined()
	})

	it('notes days still being counted and values grouped together, once for every section', async () => {
		mocks.fetchQueryMock.mockImplementation((_route, request) =>
			Promise.resolve(answer(request, { partial: { missingDays: 2 }, capped: { days: 1 } }))
		)
		await renderView()
		expect(screen.getAllByText(keys.statePartial)).toHaveLength(1)
		expect(screen.getAllByText(keys.stateCapped)).toHaveLength(1)
	})

	it('notes a read the source answered without one of the filters it carried', async () => {
		mocks.fetchQueryMock.mockImplementation((_route, request) =>
			Promise.resolve(
				answer(request, {
					unappliedFilters: [{ dimension: 'page', operator: 'eq', value: '/pricing' }],
				})
			)
		)
		await renderView()
		expect(screen.getByText(keys.stateFiltersUnapplied)).toBeDefined()
	})

	it('says the goals could not be read rather than showing them as unconverted', async () => {
		answerGoalsUnresolved()
		await renderView()
		expect(screen.getByText(keys.stateGoalsUnresolved)).toBeDefined()
		expect(screen.queryByText(keys.stateNoBreakdown)).toBeNull()
	})

	it('repeats the unresolved-goals state on the goals tab, where the breakdown is empty too', async () => {
		mocks.search = 'tab=goals'
		answerGoalsUnresolved()
		await renderView()
		expect(screen.getAllByText(keys.stateGoalsUnresolved)).toHaveLength(2)
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

	it('refreshes the cache and reissues every section read', async () => {
		await renderView()
		const before = mocks.fetchQueryMock.mock.calls.length
		expect(before).toBe(4)

		await clickRefresh()

		expect(mocks.refreshCacheMock).toHaveBeenCalledTimes(1)
		expect(mocks.refreshCacheMock.mock.calls[0]?.[0]).toBe('/api/_x/refresh')
		expect(mocks.fetchQueryMock.mock.calls.length).toBe(before + 4)
	})

	it('leaves the reads alone and reports a refresh that failed', async () => {
		mocks.refreshCacheMock.mockRejectedValue(new Error('refresh down'))
		await renderView()
		const before = mocks.fetchQueryMock.mock.calls.length

		await clickRefresh()

		expect(screen.getByText(keys.viewRefreshFailed)).toBeDefined()
		expect(mocks.fetchQueryMock.mock.calls.length).toBe(before)

		mocks.refreshCacheMock.mockResolvedValue({ epoch: 'tok-2' })
		await clickRefresh()
		expect(screen.queryByText(keys.viewRefreshFailed)).toBeNull()
	})

	it('clears the failure notice as soon as the next attempt starts', async () => {
		mocks.refreshCacheMock.mockRejectedValue(new Error('refresh down'))
		await renderView()
		await clickRefresh()
		expect(screen.getByText(keys.viewRefreshFailed)).toBeDefined()

		const settle = holdRefresh()
		await clickRefresh()

		expect(screen.queryByText(keys.viewRefreshFailed)).toBeNull()
		await act(async () => {
			settle({ epoch: 'tok-2' })
		})
	})

	it('marks the button aria-disabled while the refresh is in flight', async () => {
		const settle = holdRefresh()
		await renderView()
		await clickRefresh()

		const pending = screen.getByRole('button', { name: keys.viewRefreshing })
		expect(pending.getAttribute('aria-disabled')).toBe('true')
		expect(pending.hasAttribute('disabled')).toBe(false)

		await act(async () => {
			settle({ epoch: 'tok-2' })
		})
		expect(screen.getByRole('button', { name: keys.viewRefresh })).toBeDefined()
		expect(mocks.refreshCacheMock).toHaveBeenCalledTimes(1)
	})
})

describe('AnalyticsViewClient accessibility', () => {
	it('has no structural accessibility violations with every section drawn and compared', async () => {
		mocks.search = 'compare=1'
		mocks.fetchQueryMock.mockImplementation((_route, request) => {
			const current = answer(request)
			return Promise.resolve({
				...current,
				comparison: { ...current.result, totals: { pageviews: 1000, visitors: 500 } },
			})
		})
		const { container } = await renderView()
		expect(container.querySelector('.analytics-delta')).not.toBeNull()
		expect(a11yViolations(container)).toEqual([])
	})

	it('titles each panel with a heading that names its region', async () => {
		await renderView()
		expect(
			screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
		).toEqual([METRIC_KEYS.pageviews, keys.viewBreakdowns, keys.goalsCollectionPlural])
		expect(screen.getByRole('region', { name: METRIC_KEYS.pageviews })).toBeDefined()
		expect(screen.getByRole('region', { name: keys.viewBreakdowns })).toBeDefined()
		expect(screen.getByRole('region', { name: keys.goalsCollectionPlural })).toBeDefined()
	})

	it('reads the trend from a hidden data table and the lists as tables with headers', async () => {
		const { container } = await renderView()
		const trend = screen.getByRole('region', { name: METRIC_KEYS.pageviews })
		expect(within(trend).getByRole('img').getAttribute('aria-label')).toContain(
			METRIC_KEYS.pageviews
		)
		const data = within(trend).getByRole('table')
		expect(data.parentElement?.className).toBe('analytics-sr-only')
		expect(
			within(data)
				.getAllByRole('columnheader')
				.map((header) => header.textContent)
		).toEqual([keys.viewTrendPeriod, METRIC_KEYS.pageviews])
		const breakdown = container.querySelector<HTMLElement>('.analytics-view__breakdown')
		if (!breakdown) {
			throw new Error('no breakdown')
		}
		expect(within(breakdown).getByRole('table').querySelector('[aria-sort]')?.textContent).toBe(
			METRIC_KEYS.pageviews
		)
		expect(
			within(breakdown)
				.getAllByRole('rowheader')
				.map((cell) => cell.textContent)
		).toEqual(['/pricing', '/about'])
	})

	// A roving tab strip keeps one tab in the order; everything else a reader can use is in it.
	it('keeps every control in the tab order but the tabs not selected', async () => {
		const { container } = await renderView()
		const out = [...container.querySelectorAll('[tabindex="-1"]')]
		expect(out.length).toBeGreaterThan(0)
		expect(out.every((element) => element.getAttribute('role') === 'tab')).toBe(true)
		expect(out.every((element) => element.getAttribute('aria-selected') === 'false')).toBe(true)
		for (const button of container.querySelectorAll('button')) {
			expect(button.hasAttribute('disabled')).toBe(false)
		}
	})
})

describe('AnalyticsViewClient site', () => {
	const alpha = { current: 'alpha', own: 'alpha', ownLabel: 'Alpha', canAggregate: true }
	const caption = (): Element | null => document.querySelector('.analytics-view__title + span')

	// The select names the site the numbers belong to, so a caption beside the title would
	// say the same thing twice.
	it('drops the Showing caption where the Site select says it', async () => {
		await renderView({ scopes: alpha })
		expect(screen.getByLabelText(keys.viewScopeSite)).toBeDefined()
		expect(screen.queryByText(new RegExp(keys.viewScopeShowing))).toBeNull()
		expect(caption()).toBeNull()
	})

	it('keeps the caption for a reader the select is not drawn for', async () => {
		await renderView({ scopes: { ...alpha, canAggregate: false } })
		expect(screen.queryByLabelText(keys.viewScopeSite)).toBeNull()
		expect(caption()?.textContent).toBe(
			`${keys.viewScopeShowing} ${JSON.stringify({ site: '⁨Alpha⁩' })}`
		)
	})

	it('writes All sites to the URL tagged with the tenant it was picked from', async () => {
		await renderView({ scopes: alpha })
		fireEvent.change(screen.getByLabelText(keys.viewScopeSite), { target: { value: '*' } })
		expect(mocks.push).toHaveBeenCalledWith('/admin/analytics?scope=*%3Aalpha', {
			scroll: false,
		})
	})

	it('writes nothing for the tenant itself, leaving the URL bare', async () => {
		mocks.search = 'scope=*%3Aalpha'
		await renderView({ scopes: { ...alpha, current: '*' }, scopeParam: '*:alpha' })
		fireEvent.change(screen.getByLabelText(keys.viewScopeSite), { target: { value: 'alpha' } })
		expect(mocks.push).toHaveBeenCalledWith('/admin/analytics', { scroll: false })
	})

	// The scope is the one thing the server resolves, so it is the one step through the router.
	it('changes the scope through the router and nothing else through it', async () => {
		await renderView({ scopes: alpha })
		fireEvent.change(screen.getByLabelText(keys.viewScopeSite), { target: { value: '*' } })
		expect(mocks.push).toHaveBeenCalledTimes(1)
		expect(window.history.pushState).not.toHaveBeenCalled()
		const cards = within(screen.getByRole('group', { name: keys.viewOverview }))
		fireEvent.click(cards.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(mocks.push).toHaveBeenCalledTimes(1)
		expect(window.history.pushState).toHaveBeenCalledTimes(1)
	})
})

describe('AnalyticsViewClient source switch', () => {
	const plausibleCaps: SerializedCapabilities = { ...nativeCaps }
	const twoSources = (): Partial<AnalyticsViewClientProps> => ({
		sources: {
			defaultId: 'native',
			sources: [
				{ id: 'native', label: 'Native', kind: 'config', capabilities: nativeCaps },
				{ id: 'plausible', label: 'Beta Plausible', kind: 'config', capabilities: plausibleCaps },
			],
		},
	})
	const refused = () =>
		new QueryFetchError(502, {
			code: 'source_misconfigured',
			message: 'refused host',
			param: 'host',
		})

	it('says once that the source itself failed, and draws no section that only repeats it', async () => {
		mocks.fetchQueryMock.mockImplementation(() => Promise.reject(refused()))
		const { container } = await renderView(twoSources())
		expect(screen.getAllByText(keys.viewErrorHostRefused)).toHaveLength(1)
		expect(container.querySelector('.analytics-view__breakdown')).toBeNull()
		expect(screen.queryByLabelText(keys.widgetFieldLimit)).toBeNull()
		expect(screen.queryByRole('region', { name: METRIC_KEYS.pageviews })).toBeNull()
		expect(screen.queryByRole('region', { name: keys.goalsCollectionPlural })).toBeNull()
	})

	it('keeps each section saying its own failure when it is not the source failing', async () => {
		mocks.fetchQueryMock.mockImplementation(() => Promise.reject(new Error('network down')))
		await renderView()
		expect(screen.getAllByText(keys.viewErrorGeneric).length).toBeGreaterThan(1)
	})

	// Neither while the new source loads nor after it fails.
	it("never shows the previous source's numbers under the new one's name", async () => {
		const { rerender } = await renderView(twoSources())
		expect(screen.getByText('1,234')).toBeDefined()

		let fail: ((err: unknown) => void) | undefined
		mocks.fetchQueryMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					fail = reject
				})
		)
		fireEvent.change(screen.getByLabelText(keys.viewSourceLabel), {
			target: { value: 'plausible' },
		})
		expect(pushed()).toEqual(['/admin/analytics?source=plausible'])
		mocks.search = 'source=plausible'
		rerender(<AnalyticsViewClient {...props(twoSources())} />)

		expect(screen.queryByText('1,234')).toBeNull()
		expect(screen.queryByRole('button', { name: /\/pricing/ })).toBeNull()
		expect(document.querySelectorAll('.analytics-view__skeleton').length).toBeGreaterThan(0)

		await act(async () => {
			fail?.(refused())
		})
		await act(async () => {})
		expect(screen.queryByText('1,234')).toBeNull()
		expect(screen.queryByRole('button', { name: /\/pricing/ })).toBeNull()
		expect(screen.getAllByText(keys.viewErrorHostRefused).length).toBeGreaterThan(0)
		expect(screen.queryByText(keys.viewErrorMisconfigured)).toBeNull()
	})

	it('keeps the numbers on screen, dimmed, while another window of the same source loads', async () => {
		const { rerender } = await renderView()
		mocks.fetchQueryMock.mockImplementation(() => new Promise(() => {}))
		mocks.search = 'range=last7days'
		rerender(<AnalyticsViewClient {...props()} />)
		expect(screen.getByText('1,234')).toBeDefined()
		expect(screen.getByRole('group', { name: keys.viewOverview }).getAttribute('aria-busy')).toBe(
			'true'
		)
	})
})

describe('AnalyticsViewClient address', () => {
	it('replaces a correction in the history, never through the router', async () => {
		mocks.search = 'source=retired&metric=visitors'
		await renderView()
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(replaced()).toEqual(['/admin/analytics?metric=visitors'])
		expect(mocks.replace).not.toHaveBeenCalled()
		expect(mocks.push).not.toHaveBeenCalled()
	})

	// Back and Forward are the router's own `popstate` handling of the entries the view pushed;
	// this emulates it (Next patches `pushState` the same way) to show the view follows.
	it('restores each step on Back and Forward without a server round trip', async () => {
		History.prototype.replaceState.call(window.history, null, '', '/admin/analytics')
		vi.mocked(window.history.pushState).mockImplementation((data, unused, url) => {
			History.prototype.pushState.call(window.history, data, unused, url)
			navigate(window.location.search)
		})
		const onPop = () => {
			navigate(window.location.search)
		}
		window.addEventListener('popstate', onPop)
		try {
			await renderView()
			const pressed = (): string | undefined =>
				within(screen.getByRole('group', { name: keys.viewOverview }))
					.getAllByRole('button')
					.find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent ??
				undefined
			expect(pressed()).toContain(METRIC_KEYS.pageviews)

			const cards = within(screen.getByRole('group', { name: keys.viewOverview }))
			await act(async () => {
				fireEvent.click(cards.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
			})
			expect(pressed()).toContain(METRIC_KEYS.visitors)

			// jsdom traverses through a chain of zero-delay timers, so a fixed wait races it under
			// load: the step is done when its popstate has fired, after the router's own listener.
			const traversed = (): Promise<void> =>
				new Promise((resolve) => {
					window.addEventListener('popstate', () => resolve(), { once: true })
				})
			await act(async () => {
				const popped = traversed()
				window.history.back()
				await popped
			})
			expect(window.location.search).toBe('')
			expect(pressed()).toContain(METRIC_KEYS.pageviews)

			await act(async () => {
				const popped = traversed()
				window.history.forward()
				await popped
			})
			expect(window.location.search).toBe('?metric=visitors')
			expect(pressed()).toContain(METRIC_KEYS.visitors)
			expect(mocks.push).not.toHaveBeenCalled()
		} finally {
			window.removeEventListener('popstate', onPop)
		}
	})
})

describe('AnalyticsViewClient clock', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	// One clock: the window the toolbar names and the window the reads ask for move together.
	it('moves the caption and the reads to the new day together when the reader comes back', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		// 23:30 in Berlin, the reporting zone.
		vi.setSystemTime(new Date('2026-09-14T21:30:00.000Z'))
		await renderView()
		expect(daysCaption()).toBe('Aug 16 \u2013 Sep 14, 2026')
		expect(mocks.fetchQueryMock.mock.calls.at(-1)?.[1].to).toBe('2026-09-14')

		vi.setSystemTime(new Date('2026-09-14T22:30:00.000Z'))
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange'))
		})
		expect(daysCaption()).toBe('Aug 17 \u2013 Sep 15, 2026')
		expect(mocks.fetchQueryMock.mock.calls.at(-1)?.[1].to).toBe('2026-09-15')
	})

	// The refresh moves the clock past midnight, so its reads are the new day's; reissuing the old
	// day's would abort them and leave every section loading for good.
	it('leaves no section loading after a refresh that crossed midnight in the reporting zone', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		// 23:30 in Berlin, the reporting zone.
		vi.setSystemTime(new Date('2026-09-14T21:30:00.000Z'))
		const settle = holdRefresh()
		await renderView()

		vi.setSystemTime(new Date('2026-09-14T22:30:00.000Z'))
		await clickRefresh()
		await act(async () => {
			settle({ epoch: 'tok-2' })
		})

		const after = mocks.fetchQueryMock.mock.calls.slice(4).map((call) => call[1].to)
		expect(after.length).toBeGreaterThan(0)
		expect(new Set(after)).toEqual(new Set(['2026-09-15']))
		expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0)
		expect(daysCaption()).toBe('Aug 17 \u2013 Sep 15, 2026')
	})
})
