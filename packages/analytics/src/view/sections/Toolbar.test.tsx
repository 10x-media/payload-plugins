import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../../core/contract'
import type { WireSource } from '../../fields/config/fetchSources'
import { viewContextValue } from '../../testing/viewContext'
import { keys } from '../../translations/keys'
import { TIMEFRAME_KEYS } from '../../translations/metricKeys'
import type { ReadNotices } from '../../widgets/readMeta'
import { dayRangeDays } from '../dayRange'
import { VIEW_METRIC_ORDER } from '../gating'
import type { ViewState } from '../state'
import { ViewProvider } from '../viewContext'
import type { ViewScopes } from '../viewProps'
import { Toolbar } from './Toolbar'

vi.mock('@payloadcms/ui', async () => ({
	...(await import('../../testing/selectMocks')).selectMocks,
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DatePicker: ({
		onChange,
		overrides,
	}: {
		onChange?: (picked: [Date | null, Date | null]) => void
		overrides?: { id?: string; startDate?: Date | null; endDate?: Date | null; maxDate?: Date }
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
				data-max={day(overrides?.maxDate)}
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
	Pill: ({ children, pillStyle }: { children?: ReactNode; pillStyle?: string }) => (
		<span data-pill-style={pillStyle}>{children}</span>
	),
	useConfig: () => ({
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
	}),
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
	XIcon: () => <span aria-hidden="true" />,
}))

const nativeCaps: SerializedCapabilities = {
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: Object.fromEntries(
		DIMENSION_KEYS.map((dimension) => [dimension, [...FILTER_OPERATORS]])
	),
	realtime: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
}

const narrowCaps: SerializedCapabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page'],
	filters: {},
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: 90,
}

const source = (id: string, capabilities: SerializedCapabilities): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities,
})

const baseState: ViewState = {
	range: 'last30days',
	compare: false,
	metric: 'pageviews',
	tab: 'pages',
	filters: [],
	limit: 10,
}

const NOW = new Date('2026-09-14T09:00:00.000Z')

interface ToolbarOverrides {
	caps?: SerializedCapabilities
	sources?: WireSource[]
	state?: ViewState
	notices?: Partial<ReadNotices>
	provider?: string
	onChange?: (next: ViewState) => void
	onRefresh?: () => void
	refreshing?: boolean
	refreshFailed?: boolean
	refreshDone?: boolean
	countryFlags?: boolean
	scopes?: ViewScopes
	range?: { from: string; to: string }
}

/** The toolbar as the view renders it: everything it shows comes from the view's context. */
const inView = (overrides: ToolbarOverrides = {}) => {
	const caps = overrides.caps ?? nativeCaps
	return (
		<ViewProvider
			value={viewContextValue({
				caps,
				sources: overrides.sources ?? [source('native', caps)],
				state: overrides.state ?? baseState,
				...(overrides.notices ? { notices: overrides.notices } : {}),
				provider: overrides.provider ?? 'native',
				write: overrides.onChange ?? (() => {}),
				refresh: {
					run: overrides.onRefresh ?? (() => {}),
					pending: overrides.refreshing ?? false,
					failed: overrides.refreshFailed ?? false,
					done: overrides.refreshDone ?? false,
				},
				countryFlags: overrides.countryFlags ?? true,
				...(overrides.scopes ? { scopes: overrides.scopes } : {}),
				range: overrides.range ?? { from: '2026-08-16', to: '2026-09-14' },
				now: NOW,
			})}
		>
			<Toolbar />
		</ViewProvider>
	)
}

const renderToolbar = (overrides: ToolbarOverrides = {}) => render(inView(overrides))

const rangeSelect = (): HTMLSelectElement =>
	screen.getByLabelText(keys.widgetFieldRange) as HTMLSelectElement

const datesInput = (): HTMLInputElement => screen.getByLabelText(keys.viewDates) as HTMLInputElement

afterEach(() => {
	cleanup()
})

describe('Toolbar site select', () => {
	const alpha: ViewScopes = {
		current: 'alpha',
		own: 'alpha',
		ownLabel: 'Alpha',
		canAggregate: true,
	}
	const siteSelect = (): HTMLSelectElement =>
		screen.getByLabelText(keys.viewScopeSite) as HTMLSelectElement
	const controlLabels = (container: HTMLElement): Array<string | null> =>
		[...container.querySelectorAll<HTMLSelectElement>('.analytics-view__controls select')].map(
			(select) => select.labels?.[0]?.textContent ?? null
		)

	it('is a select named Site, first in the toolbar, offering the tenant and every site', () => {
		const { container } = renderToolbar({
			scopes: alpha,
			sources: [source('native', nativeCaps), source('plausible', nativeCaps)],
		})
		expect(controlLabels(container)).toEqual([
			keys.viewScopeSite,
			keys.viewSourceLabel,
			keys.widgetFieldRange,
		])
		expect([...siteSelect().options].map((option) => [option.value, option.text])).toEqual([
			['alpha', 'Alpha'],
			['*', keys.viewScopeAll],
		])
		expect(siteSelect().value).toBe('alpha')
		expect(screen.queryByRole('button', { name: keys.viewScopeAll })).toBeNull()
	})

	it('writes the tagged aggregate token for All sites, and nothing for the tenant', () => {
		const onChange = vi.fn()
		renderToolbar({ onChange, scopes: alpha })
		fireEvent.change(siteSelect(), { target: { value: '*' } })
		expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scope: '*:alpha' }))
		cleanup()
		const back = vi.fn()
		renderToolbar({
			onChange: back,
			scopes: { ...alpha, current: '*' },
			state: { ...baseState, scope: '*:alpha' },
		})
		expect(siteSelect().value).toBe('*')
		fireEvent.change(siteSelect(), { target: { value: 'alpha' } })
		expect(back).toHaveBeenLastCalledWith(expect.objectContaining({ scope: undefined }))
	})

	it('falls back to the scope id where the host names no label', () => {
		renderToolbar({ scopes: { current: 'alpha', own: 'alpha', canAggregate: true } })
		expect(siteSelect().options[0]?.text).toBe('alpha')
	})

	it('is not drawn for a reader who may not read across sites, or who has no site', () => {
		renderToolbar({ scopes: { ...alpha, canAggregate: false } })
		expect(screen.queryByLabelText(keys.viewScopeSite)).toBeNull()
		cleanup()
		renderToolbar({ scopes: { current: '', own: '', canAggregate: true } })
		expect(screen.queryByLabelText(keys.viewScopeSite)).toBeNull()
	})
})

describe('Toolbar controls', () => {
	it('offers no source select when the scope reads a single source', () => {
		renderToolbar()
		expect(screen.queryByLabelText(keys.viewSourceLabel)).toBeNull()
	})

	it('offers the source select once a scope reads more than one', () => {
		const onChange = vi.fn()
		renderToolbar({
			onChange,
			sources: [source('native', nativeCaps), source('plausible', nativeCaps)],
		})
		const select = screen.getByLabelText(keys.viewSourceLabel)
		fireEvent.change(select, { target: { value: 'plausible' } })
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: 'plausible' }))
	})

	it('hides the presets the source cannot look back over', () => {
		renderToolbar({ caps: narrowCaps })
		const offered = [...rangeSelect().options].map((option) => option.value)
		expect(offered).toContain('last90days')
		expect(offered).not.toContain('lastYear')
		expect(offered).toContain('custom')
	})

	it('hides the comparison toggle when the source cannot compare', () => {
		renderToolbar({ caps: narrowCaps })
		expect(screen.queryByText(keys.viewCompare)).toBeNull()
	})

	it('toggles the comparison and reports it pressed', () => {
		const onChange = vi.fn()
		renderToolbar({ onChange, state: { ...baseState, compare: true } })
		const toggle = screen.getByText(keys.viewCompare)
		expect(toggle.getAttribute('aria-pressed')).toBe('true')
		fireEvent.click(toggle)
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ compare: false }))
	})

	it('shows the range picker only on a custom range, opened on the committed days', () => {
		renderToolbar()
		expect(screen.queryByLabelText(keys.viewDates)).toBeNull()
		cleanup()
		renderToolbar({
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		expect(datesInput().value).toBe('2026-06-01..2026-06-10')
	})

	it('carries the resolved days into a switch to a custom range', () => {
		const onChange = vi.fn()
		renderToolbar({ onChange })
		fireEvent.change(rangeSelect(), { target: { value: 'custom' } })
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ range: 'custom', from: '2026-08-16', to: '2026-09-14' })
		)
	})

	it('clamps a picked window to the days the source can look back, keeping the second pick', () => {
		const onChange = vi.fn()
		renderToolbar({
			caps: narrowCaps,
			onChange,
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		fireEvent.change(datesInput(), { target: { value: '2026-01-01..2026-12-31' } })
		const next = onChange.mock.calls[0]?.[0] as ViewState
		expect(next.to).toBe('2026-12-31')
		expect(dayRangeDays({ from: String(next.from), to: String(next.to) })).toBe(90)
	})

	it('commits a picked range once, when its second day is picked', () => {
		const onChange = vi.fn()
		renderToolbar({
			onChange,
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		fireEvent.change(datesInput(), { target: { value: '2026-05-01..' } })
		expect(onChange).not.toHaveBeenCalled()
		expect(datesInput().value).toBe('2026-05-01..')
		fireEvent.change(datesInput(), { target: { value: '2026-05-01..2026-05-20' } })
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ range: 'custom', from: '2026-05-01', to: '2026-05-20' })
		)
	})

	it('drops a half-picked range once anything else commits', () => {
		const state: ViewState = { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' }
		const { rerender } = renderToolbar({ state })
		fireEvent.change(datesInput(), { target: { value: '2026-05-01..' } })
		const next: ViewState = { ...state, compare: true }
		rerender(inView({ state: next, range: { from: '2026-06-01', to: '2026-06-10' } }))
		expect(datesInput().value).toBe('2026-06-01..2026-06-10')
	})

	// One span as the language writes one, its shared year said once.
	it('captions the window and the reporting timezone', () => {
		const { container } = renderToolbar()
		const days = container.querySelector('.analytics-view__captions > span')
		expect(days?.textContent).toBe('Aug 16 \u2013 Sep 14, 2026')
		const zone = screen.getByText(/Europe\/Berlin/)
		expect(zone.closest('[title]')?.getAttribute('title')).toBe(keys.viewTimezoneHelp)
	})

	it('labels the presets with their translated names', () => {
		renderToolbar()
		expect([...rangeSelect().options].map((option) => option.label)).toContain(
			TIMEFRAME_KEYS.last7days
		)
	})

	it('badges a cached read and notes a clamped window', () => {
		renderToolbar({ notices: { clamped: true, stale: true } })
		expect(screen.getByText(keys.viewStale)).toBeDefined()
		expect(screen.getByText(keys.stateClamped)).toBeDefined()
	})

	// Saved data is how most reads arrive, which is nothing to warn about.
	it('badges a cached read in a neutral pill, not a warning', () => {
		renderToolbar({ notices: { stale: true } })
		expect(screen.getByText(keys.viewStale).getAttribute('data-pill-style')).toBe('light-gray')
	})

	it('offers no day after today, in the reporting timezone', () => {
		renderToolbar({
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		expect(datesInput().getAttribute('data-max')).toBe('2026-09-14')
	})

	// A zone like America/New_York keeps its own direction on a right-to-left page.
	it('isolates the reporting timezone in its caption', () => {
		const { container } = renderToolbar()
		expect(container.querySelector('.analytics-view__captions bdi')?.textContent).toBe(
			'Europe/Berlin'
		)
	})

	it('says nothing about caching or clamping on a fresh full read', () => {
		renderToolbar()
		expect(screen.queryByText(keys.viewStale)).toBeNull()
		expect(screen.queryByText(keys.stateClamped)).toBeNull()
		expect(screen.queryByText(keys.stateFiltersUnapplied)).toBeNull()
		expect(screen.queryByText(keys.stateSampled)).toBeNull()
	})

	it('notes a read the source answered without one of its filters', () => {
		renderToolbar({ notices: { filtersUnapplied: true } })
		expect(screen.getByText(keys.stateFiltersUnapplied)).toBeDefined()
	})

	it('notes a read its source counted from a sample', () => {
		renderToolbar({ notices: { sampled: true } })
		expect(screen.getByText(keys.stateSampled)).toBeDefined()
	})

	it('notes a PostHog project dropping visits counted without consent', () => {
		renderToolbar({ notices: { withoutConsentDropped: true } })
		expect(screen.getByText(keys.statePosthogCookielessDropped)).toBeDefined()
	})

	it('notes how many pageviews were recorded without a visitor', () => {
		renderToolbar({ notices: { withoutVisitor: 1204 } })
		expect(
			screen.getByText(`${keys.stateWithoutVisitor} ${JSON.stringify({ count: '1,204' })}`)
		).toBeDefined()
	})

	it('says when revenue adds amounts in several currencies, naming them', () => {
		renderToolbar({ notices: { mixedCurrencies: ['EUR', 'USD'] } })
		expect(
			screen.getByText(
				`${keys.stateMixedCurrencies} ${JSON.stringify({ currencies: 'EUR and USD' })}`
			)
		).toBeDefined()
	})

	it('says nothing about currencies while revenue is in one', () => {
		renderToolbar({ notices: { mixedCurrencies: ['EUR'] } })
		expect(screen.queryByText(new RegExp(keys.stateMixedCurrencies))).toBeNull()
	})

	it('notes days still being counted, values grouped together and a zone it could not find', () => {
		renderToolbar({ notices: { partial: true, capped: true, timezoneUnresolved: true } })
		expect(screen.getByText(keys.statePartial)).toBeDefined()
		expect(screen.getByText(keys.stateCapped)).toBeDefined()
		expect(screen.getByText(keys.stateTimezoneUnresolved)).toBeDefined()
	})

	it('says how long ago a snapshot brought the numbers up to date', () => {
		renderToolbar({ notices: { asOf: new Date(NOW.getTime() - 3 * 60_000).toISOString() } })
		expect(
			screen.getByText(`${keys.stateUpdated} ${JSON.stringify({ ago: '3 minutes ago' })}`)
		).toBeDefined()
	})

	it('leaves the goal states to the goal sections', () => {
		renderToolbar({ notices: { goalsUnresolved: true } })
		expect(screen.queryByText(keys.stateGoalsUnresolved)).toBeNull()
	})

	it('removes a filter chip through its own button', () => {
		const onChange = vi.fn()
		renderToolbar({
			onChange,
			state: {
				...baseState,
				filters: [{ dimension: 'page', operator: 'eq', value: '/pricing' }],
			},
		})
		expect(screen.getByText(/\/pricing/)).toBeDefined()
		fireEvent.click(screen.getByRole('button', { name: new RegExp(keys.viewFilterRemove) }))
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ filters: [] }))
	})

	it('names a native channel chip in the reader language and leaves a provider one raw', () => {
		const state: ViewState = {
			...baseState,
			filters: [{ dimension: 'channel', operator: 'eq', value: 'organic-search' }],
		}
		renderToolbar({ state })
		expect(screen.getByText(new RegExp(keys.channelOrganicSearch))).toBeDefined()
		cleanup()
		renderToolbar({ state, provider: 'plausible' })
		expect(screen.queryByText(new RegExp(keys.channelOrganicSearch))).toBeNull()
		expect(screen.getByText(/organic-search/)).toBeDefined()
	})

	it('draws a flag beside a country chip, and drops it when the install said false', () => {
		const state: ViewState = {
			...baseState,
			filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
		}
		renderToolbar({ state })
		expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/_x/flags/de.svg')
		cleanup()
		renderToolbar({ state, countryFlags: false })
		expect(document.querySelector('img')).toBeNull()
		expect(screen.getByText(/Germany/)).toBeDefined()
	})
})

describe('Toolbar refresh', () => {
	it('asks the view to refresh when the button is clicked', () => {
		const onRefresh = vi.fn()
		renderToolbar({ onRefresh })
		const button = screen.getByRole('button', { name: keys.viewRefresh })
		expect(button.getAttribute('aria-disabled')).toBe('false')
		fireEvent.click(button)
		expect(onRefresh).toHaveBeenCalledTimes(1)
	})

	// The button stays focusable while the refresh runs, so the keyboard user who pressed it
	// is still on it when it comes back rather than back at the top of the document.
	it('marks the button aria-disabled and renames it while the refresh is pending', () => {
		const onRefresh = vi.fn()
		renderToolbar({ onRefresh, refreshing: true })
		expect(screen.queryByRole('button', { name: keys.viewRefresh })).toBeNull()
		const button = screen.getByRole('button', { name: keys.viewRefreshing })
		expect(button.getAttribute('aria-disabled')).toBe('true')
		expect(button.hasAttribute('disabled')).toBe(false)
		button.focus()
		expect(document.activeElement).toBe(button)
		fireEvent.click(button)
		expect(onRefresh).not.toHaveBeenCalled()
	})

	it('reports a refresh that failed, and says nothing otherwise', () => {
		renderToolbar()
		expect(screen.queryByText(keys.viewRefreshFailed)).toBeNull()
		cleanup()
		renderToolbar({ refreshFailed: true })
		expect(screen.getByText(keys.viewRefreshFailed)).toBeDefined()
	})

	it('keeps the failure notice in a live region that is mounted before it has text', () => {
		renderToolbar()
		const region = screen.getByRole('status')
		expect(region.textContent).toBe('')
		cleanup()
		renderToolbar({ refreshFailed: true })
		expect(screen.getByRole('status').textContent).toContain(keys.viewRefreshFailed)
	})

	// A refresh that worked changes the numbers in place; the status region says so, once.
	it('says a refresh succeeded in the live region, without showing it', () => {
		const { rerender } = renderToolbar()
		const region = screen.getByRole('status')
		rerender(inView({ refreshDone: true }))
		expect(region.textContent).toBe(keys.viewRefreshed)
		expect(region.querySelector('.analytics-sr-only')).not.toBeNull()
		rerender(inView({ refreshing: true }))
		expect(region.textContent).toBe('')
	})
})
