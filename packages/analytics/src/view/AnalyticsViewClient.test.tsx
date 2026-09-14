import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import { keys } from '../translations/keys'
import { TIMEFRAME_KEYS } from '../translations/metricKeys'
import { AnalyticsViewClient } from './AnalyticsViewClient'
import type { AnalyticsViewClientProps } from './viewProps'

vi.mock('@payloadcms/ui', () => ({
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const capabilities = {
	metrics: ['pageviews'],
	dimensions: [],
	filters: [],
	filterOperators: [],
	realtime: false,
	perPageQuery: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
} as unknown as SerializedCapabilities

const props = (overrides: Partial<AnalyticsViewClientProps> = {}): AnalyticsViewClientProps => ({
	sources: {
		defaultId: 'native',
		sources: [
			{ id: 'plausible', label: 'Plausible', kind: 'config', capabilities },
			{ id: 'native', label: 'Native', kind: 'config', capabilities },
		],
	},
	goals: [],
	defaults: { range: 'last7days', metric: 'pageviews' },
	apiRoute: '/api',
	adminRoute: '/admin',
	timezone: 'Europe/Berlin',
	locale: 'en',
	...overrides,
})

afterEach(() => {
	cleanup()
})

describe('AnalyticsViewClient', () => {
	it('renders the translated title and loading line', () => {
		render(<AnalyticsViewClient {...props()} />)
		expect(screen.getByRole('heading').textContent).toBe(keys.viewTitle)
		expect(screen.getByText(keys.viewLoading)).toBeDefined()
	})

	it('summarizes the default source and the default range from props', () => {
		render(<AnalyticsViewClient {...props()} />)
		expect(screen.getByText(`Native · ${TIMEFRAME_KEYS.last7days}`)).toBeDefined()
	})

	it('falls back to the first source when the default id names none', () => {
		render(
			<AnalyticsViewClient
				{...props({
					sources: {
						defaultId: null,
						sources: [{ id: 'plausible', label: 'Plausible', kind: 'config', capabilities }],
					},
				})}
			/>
		)
		expect(screen.getByText(`Plausible · ${TIMEFRAME_KEYS.last7days}`)).toBeDefined()
	})

	it('shows the range alone when no source resolved for the request', () => {
		render(
			<AnalyticsViewClient
				{...props({
					sources: { defaultId: null, sources: [] },
					defaults: { range: 'today', metric: 'visitors' },
				})}
			/>
		)
		expect(screen.getByText(TIMEFRAME_KEYS.today)).toBeDefined()
	})
})
