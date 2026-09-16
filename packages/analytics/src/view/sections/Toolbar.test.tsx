import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../../core/contract'
import type { WireSource } from '../../fields/config/fetchSources'
import { keys } from '../../translations/keys'
import { TIMEFRAME_KEYS } from '../../translations/metricKeys'
import { dayRangeDays } from '../dayRange'
import { gate, VIEW_METRIC_ORDER } from '../gating'
import type { ViewState } from '../state'
import { Toolbar } from './Toolbar'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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
	realtime: true,
	perPageQuery: true,
	comparison: true,
	minGranularity: 'hour',
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

const renderToolbar = (
	overrides: {
		caps?: SerializedCapabilities
		sources?: WireSource[]
		state?: ViewState
		stale?: boolean
		clamped?: boolean
		filtersUnapplied?: boolean
		sampled?: boolean
		provider?: string
		onChange?: (next: ViewState) => void
		onChangeDeferred?: (next: ViewState) => void
	} = {}
) => {
	const caps = overrides.caps ?? nativeCaps
	const state = overrides.state ?? baseState
	return render(
		<Toolbar
			clamped={overrides.clamped ?? false}
			filtersUnapplied={overrides.filtersUnapplied ?? false}
			gate={gate(caps)}
			locale="en"
			now={NOW}
			onChange={overrides.onChange ?? (() => {})}
			onChangeDeferred={overrides.onChangeDeferred ?? (() => {})}
			provider={overrides.provider ?? 'native'}
			range={{ from: '2026-08-16', to: '2026-09-14' }}
			sampled={overrides.sampled ?? false}
			sourceId="native"
			sources={overrides.sources ?? [source('native', caps)]}
			stale={overrides.stale ?? false}
			state={state}
			stateKey={JSON.stringify(state)}
			timezone="Europe/Berlin"
		/>
	)
}

const rangeSelect = (): HTMLSelectElement =>
	screen.getByLabelText(keys.widgetFieldRange) as HTMLSelectElement

afterEach(() => {
	cleanup()
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

	it('shows the custom day inputs only on a custom range', () => {
		renderToolbar()
		expect(screen.queryByLabelText(keys.viewFrom)).toBeNull()
		cleanup()
		renderToolbar({
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		expect((screen.getByLabelText(keys.viewFrom) as HTMLInputElement).value).toBe('2026-06-01')
		expect((screen.getByLabelText(keys.viewTo) as HTMLInputElement).value).toBe('2026-06-10')
	})

	it('carries the resolved days into a switch to a custom range', () => {
		const onChange = vi.fn()
		renderToolbar({ onChange })
		fireEvent.change(rangeSelect(), { target: { value: 'custom' } })
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ range: 'custom', from: '2026-08-16', to: '2026-09-14' })
		)
	})

	it('clamps a picked window to the days the source can look back', () => {
		const onChangeDeferred = vi.fn()
		renderToolbar({
			caps: narrowCaps,
			onChangeDeferred,
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		fireEvent.change(screen.getByLabelText(keys.viewTo), { target: { value: '2026-12-31' } })
		const next = onChangeDeferred.mock.calls[0]?.[0] as ViewState
		expect(next.to).toBe('2026-12-31')
		expect(dayRangeDays({ from: String(next.from), to: String(next.to) })).toBe(90)
	})

	it('merges a second day edit into the first when both land inside the debounce', () => {
		const onChangeDeferred = vi.fn()
		renderToolbar({
			onChangeDeferred,
			state: { ...baseState, range: 'custom', from: '2026-06-01', to: '2026-06-10' },
		})
		fireEvent.change(screen.getByLabelText(keys.viewFrom), { target: { value: '2026-05-01' } })
		fireEvent.change(screen.getByLabelText(keys.viewTo), { target: { value: '2026-05-20' } })
		expect(onChangeDeferred).toHaveBeenLastCalledWith(
			expect.objectContaining({ range: 'custom', from: '2026-05-01', to: '2026-05-20' })
		)
	})

	it('captions the window and the reporting timezone', () => {
		renderToolbar()
		expect(screen.getByText('Aug 16, 2026 - Sep 14, 2026')).toBeDefined()
		expect(screen.getByText(/Europe\/Berlin/)).toBeDefined()
	})

	it('labels the presets with their translated names', () => {
		renderToolbar()
		expect([...rangeSelect().options].map((option) => option.label)).toContain(
			TIMEFRAME_KEYS.last7days
		)
	})

	it('badges a cached read and notes a clamped window', () => {
		renderToolbar({ clamped: true, stale: true })
		expect(screen.getByText(keys.viewStale)).toBeDefined()
		expect(screen.getByText(keys.stateClamped)).toBeDefined()
	})

	it('says nothing about caching or clamping on a fresh full read', () => {
		renderToolbar()
		expect(screen.queryByText(keys.viewStale)).toBeNull()
		expect(screen.queryByText(keys.stateClamped)).toBeNull()
		expect(screen.queryByText(keys.stateFiltersUnapplied)).toBeNull()
		expect(screen.queryByText(keys.stateSampled)).toBeNull()
	})

	it('notes a read the source answered without one of its filters', () => {
		renderToolbar({ filtersUnapplied: true })
		expect(screen.getByText(keys.stateFiltersUnapplied)).toBeDefined()
	})

	it('notes a read that hit its source event scan cap', () => {
		renderToolbar({ sampled: true })
		expect(screen.getByText(keys.stateSampled)).toBeDefined()
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

	it('names a native source chip as a channel and leaves a provider one as its raw token', () => {
		const state: ViewState = {
			...baseState,
			filters: [{ dimension: 'source', operator: 'eq', value: 'search' }],
		}
		renderToolbar({ state })
		expect(screen.getByText(new RegExp(keys.channelSearch))).toBeDefined()
		cleanup()
		renderToolbar({ state, provider: 'plausible' })
		expect(screen.queryByText(new RegExp(keys.channelSearch))).toBeNull()
		expect(screen.getByText(/search/)).toBeDefined()
	})
})
