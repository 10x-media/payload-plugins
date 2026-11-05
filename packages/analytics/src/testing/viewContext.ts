import type { SerializedCapabilities } from '../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import type { WireSource } from '../fields/config/fetchSources'
import type { QueryResponse } from '../query/response'
import type { RequestState } from '../ui/data/useRequest'
import { type DayRange, gate, VIEW_METRIC_ORDER } from '../view/gating'
import type { ViewState } from '../view/state'
import type { ViewAnswers, ViewFrame, ViewRefresh } from '../view/viewContext'
import type { AnalyticsViewClientProps, ViewScopes } from '../view/viewProps'
import { mergeNotices, type ReadNotices } from '../widgets/readMeta'

/** A source that serves everything the view can ask for. */
const fullCapabilities: SerializedCapabilities = {
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

const wireSource = (id: string, capabilities: SerializedCapabilities): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities,
})

const baseViewState: ViewState = {
	range: 'last30days',
	compare: false,
	metric: 'pageviews',
	tab: 'pages',
	filters: [],
	limit: 10,
}

const pending = (): RequestState<QueryResponse> => ({
	status: 'loading',
	isRefetching: false,
	refetch: () => {},
})

export interface ViewFixture {
	caps?: SerializedCapabilities
	sources?: WireSource[]
	state?: ViewState
	notices?: Partial<ReadNotices>
	provider?: string
	itemLabels?: ViewAnswers['itemLabels']
	write?: (next: ViewState) => void
	refresh?: Partial<ViewRefresh>
	countryFlags?: boolean
	scopes?: ViewScopes
	range?: DayRange
	now?: Date
	timezone?: string
}

/** A view context for a section rendered on its own, as `AnalyticsViewClient` would provide it. */
export const viewContextValue = (fixture: ViewFixture = {}): ViewFrame => {
	const caps = fixture.caps ?? fullCapabilities
	const sources = fixture.sources ?? [wireSource('native', caps)]
	const source = sources[0] ?? wireSource('native', caps)
	const state = fixture.state ?? baseViewState
	const props: AnalyticsViewClientProps = {
		sources: { defaultId: source.id, sources },
		goals: [],
		countryFlags: fixture.countryFlags ?? true,
		defaults: { range: 'last30days', metric: 'pageviews' },
		endpoints: { query: '/api/_x/query', refresh: '/api/_x/refresh', live: '/api/_x/live' },
		adminRoute: '/admin',
		timezone: fixture.timezone ?? 'Europe/Berlin',
		locale: 'en',
		scopeKey: '',
		...(fixture.scopes ? { scopes: fixture.scopes } : {}),
	}
	return {
		props,
		state,
		stateKey: JSON.stringify(state),
		source,
		gate: gate(caps),
		range: fixture.range ?? { from: '2026-08-16', to: '2026-09-14' },
		now: fixture.now ?? new Date('2026-09-14T09:00:00.000Z'),
		queries: { cards: pending(), trend: pending(), breakdown: pending(), goals: null },
		answers: {
			provider: fixture.provider ?? 'native',
			notices: mergeNotices(fixture.notices),
			...(fixture.itemLabels ? { itemLabels: fixture.itemLabels } : {}),
		},
		write: fixture.write ?? (() => {}),
		refresh: {
			run: fixture.refresh?.run ?? (() => {}),
			pending: fixture.refresh?.pending ?? false,
			failed: fixture.refresh?.failed ?? false,
			done: fixture.refresh?.done ?? false,
		},
	}
}
