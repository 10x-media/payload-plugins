import type { TabsField, UIField } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	analyticsFields,
	analyticsStat,
	analyticsStatRow,
	analyticsTab,
	analyticsTabsField,
} from './factories'

const fieldComponent = (field: UIField) => {
	const component = field.admin?.components?.Field
	if (!component || typeof component !== 'object') throw new Error('expected a component object')
	return component as { path: string; serverProps?: Record<string, unknown> }
}

describe('analyticsStat', () => {
	it('builds a ui field pointing at the RSC with the metric in serverProps', () => {
		const field = analyticsStat({ metric: 'pageviews' }) as UIField
		expect(field.type).toBe('ui')
		expect(field.name).toBe('analytics_pageviews')
		const component = fieldComponent(field)
		expect(component.path).toBe('@10x-media/analytics/rsc#AnalyticsStatField')
		expect(component.serverProps?.metrics).toEqual(['pageviews'])
		expect(component.serverProps?.timeframe).toBe('last30days')
		expect(component.serverProps?.variant).toBe('stat')
	})

	it('honors a custom name, timeframe, adapter, and sidebar position', () => {
		const field = analyticsStat({
			metric: 'visitors',
			name: 'pageVisitors',
			timeframe: 'last7days',
			adapter: 'ga4',
			position: 'sidebar',
		}) as UIField
		expect(field.name).toBe('pageVisitors')
		expect(field.admin?.position).toBe('sidebar')
		const component = fieldComponent(field)
		expect(component.serverProps?.timeframe).toBe('last7days')
		expect(component.serverProps?.adapterId).toBe('ga4')
	})
})

describe('analyticsStatRow', () => {
	it('defaults to the four core native metrics and variant row', () => {
		const field = analyticsStatRow() as UIField
		expect(field.name).toBe('analytics_stats')
		const component = fieldComponent(field)
		expect(component.serverProps?.metrics).toEqual([
			'pageviews',
			'visitors',
			'sessions',
			'avgDuration',
		])
		expect(component.serverProps?.variant).toBe('row')
	})
})

describe('analyticsFields', () => {
	it('returns one stat field per metric', () => {
		const fields = analyticsFields({ metrics: ['pageviews', 'visitors'] })
		expect(fields).toHaveLength(2)
		expect((fields[0] as UIField).name).toBe('analytics_pageviews')
		expect((fields[1] as UIField).name).toBe('analytics_visitors')
	})
})

describe('analyticsTab', () => {
	it('builds a plain tab containing a stat row, usable inside a host tabs field', () => {
		const tab = analyticsTab()
		expect('type' in tab).toBe(false)
		expect(tab.fields).toHaveLength(1)
		expect((tab.fields[0] as UIField).type).toBe('ui')
		const host: TabsField = { type: 'tabs', tabs: [tab] }
		expect(host.tabs).toHaveLength(1)
	})

	it('forwards metrics, timeframe, and adapter to the stat row', () => {
		const tab = analyticsTab({ metrics: ['visitors'], timeframe: 'last7days', adapter: 'ga4' })
		const component = fieldComponent(tab.fields[0] as UIField)
		expect(component.serverProps?.metrics).toEqual(['visitors'])
		expect(component.serverProps?.timeframe).toBe('last7days')
		expect(component.serverProps?.adapterId).toBe('ga4')
	})
})

describe('analyticsTabsField', () => {
	it('builds a tabs field wrapping a single analytics tab', () => {
		const field = analyticsTabsField()
		expect(field.type).toBe('tabs')
		expect(field.tabs).toHaveLength(1)
		const [tab] = field.tabs
		expect(tab?.fields).toHaveLength(1)
		expect((tab?.fields[0] as UIField).type).toBe('ui')
	})
})
