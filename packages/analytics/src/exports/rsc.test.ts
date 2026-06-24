import { describe, expect, it } from 'vitest'
import {
	formatMetricValue,
	readForWidget,
	readForWidgetBreakdown,
	readForWidgetRealtime,
	readForWidgetSeries,
} from './rsc'

describe('public /rsc surface', () => {
	it('exports the four widget reads as functions', () => {
		expect(typeof readForWidget).toBe('function')
		expect(typeof readForWidgetSeries).toBe('function')
		expect(typeof readForWidgetBreakdown).toBe('function')
		expect(typeof readForWidgetRealtime).toBe('function')
	})
	it('exports formatMetricValue', () => {
		expect(formatMetricValue('pageviews', 1200, 'en-US')).toBe('1,200')
	})
})
