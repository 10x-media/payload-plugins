import { describe, expect, it } from 'vitest'
import { storedWidgetData } from './widgetData'

describe('storedWidgetData', () => {
	it('keeps every part its field writes', () => {
		const stored = {
			title: 'Signups',
			metric: 'visitDuration',
			timeframe: 'custom',
			range: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-07T00:00:00.000Z' },
			dataSource: 'ga4',
			compare: true,
			filter: { dimension: 'country', operator: 'contains', value: 'DE' },
			limit: '25',
			windowMinutes: '15',
		}
		expect(storedWidgetData(stored)).toEqual(stored)
	})

	it('reads a part that is not what its field writes as unset, so the default applies', () => {
		expect(
			storedWidgetData({
				title: 7,
				metric: 'timeOnSite',
				timeframe: 'fortnight',
				range: 'last week',
				dataSource: null,
				compare: 'yes',
				filter: { dimension: 'planet', operator: '~', value: 3 },
				limit: { rows: 5 },
			})
		).toEqual({ filter: {} })
	})

	it('reads nothing from a layout entry that holds no settings at all', () => {
		expect(storedWidgetData(undefined)).toEqual({})
		expect(storedWidgetData('analytics-metric')).toEqual({})
	})
})
