import { describe, expect, it } from 'vitest'
import * as root from '../index'
import { ga4EventName } from './adapters/ga4'
import * as types from './types'
import { TRAFFIC_CHANNELS } from './types'

describe('public surface for the GA4 adapter and traffic channels', () => {
	it('exports ga4EventName from the ga4 adapter entry', () => {
		expect(ga4EventName('sign-up')).toBe('sign_up')
	})

	it('exports the traffic channels a native channel row can hold', () => {
		expect(TRAFFIC_CHANNELS).toContain('organic-search')
	})
})

// Documented as values: a type-only export compiles and then reads undefined at runtime.
describe('the constants the root and /types document', () => {
	it('are values at runtime, from both entries', () => {
		expect(root.BUILT_IN_WIDGET_SLUGS).toContain('analytics-metric')
		expect(root.PROVIDER_IDS).toContain('native')
		expect(root.TIMEFRAME_PRESETS).toContain('today')
		expect(root.keys.viewTitle).toBe('analytics:viewTitle')
		expect(Object.keys(root.pluralKeys).length).toBeGreaterThan(0)
		expect(root.GOAL_ACTION_TYPE).toBe('analyticsGoal')
		expect(types.BUILT_IN_WIDGET_SLUGS).toBe(root.BUILT_IN_WIDGET_SLUGS)
		expect(types.TIMEFRAME_PRESETS).toBe(root.TIMEFRAME_PRESETS)
		expect(types.keys).toBe(root.keys)
		expect(types.pluralKeys).toBe(root.pluralKeys)
		expect(types.GOAL_ACTION_TYPE).toBe(root.GOAL_ACTION_TYPE)
	})
})
