import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildGoalsCollection } from '../goals/collection'
import type { Goal } from '../goals/types'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { findMetricField, registerWidgets } from '../widgets/registerWidgets'
import { filterOperatorsFor } from './capabilities'
import { resolveOptions, revenueOffWarning } from './options'
import { createRegistry, withoutRevenue } from './registry'

const adapters = [memoryAdapter()]

const valued: Goal[] = [
	{ slug: 'demo', name: 'Demo', match: { kind: 'goal' }, value: { fixed: 500 } },
	{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } },
	{ slug: 'lead', name: 'Lead', match: { kind: 'goal' }, value: { prop: 'amount' } },
]

describe('resolveOptions revenue', () => {
	it('is off when unset or false, whatever the goals carry', () => {
		const off = {
			enabled: false,
			dimension: false,
			browserAmounts: 'fixed',
			orderSignature: 'optional',
		}
		expect(resolveOptions({ adapters }).revenue).toEqual(off)
		expect(resolveOptions({ adapters, revenue: false }).revenue).toEqual(off)
		expect(resolveOptions({ adapters, goals: valued }).revenue).toEqual(off)
	})

	it('is on with the defaults for true', () => {
		expect(resolveOptions({ adapters, revenue: true }).revenue).toEqual({
			enabled: true,
			dimension: true,
			browserAmounts: 'fixed',
			orderSignature: 'optional',
		})
	})

	it("takes revenue.orderSignature 'required' or 'optional', refusing anything else", () => {
		expect(
			resolveOptions({ adapters, revenue: { orderSignature: 'required' } }).revenue.orderSignature
		).toBe('required')
		expect(() =>
			resolveOptions({ adapters, revenue: { orderSignature: 'always' as never } })
		).toThrow(/revenue.orderSignature must be 'required' or 'optional', got "always"/)
	})

	it('is on for an object, carrying its currency and converter', () => {
		const convert = () => 1
		const currency = () => 'USD'
		expect(resolveOptions({ adapters, revenue: {} }).revenue).toEqual({
			enabled: true,
			dimension: true,
			browserAmounts: 'fixed',
			orderSignature: 'optional',
		})
		const revenue = resolveOptions({ adapters, revenue: { currency, convert } }).revenue
		expect(revenue).toEqual({
			enabled: true,
			currency,
			convert,
			dimension: false,
			browserAmounts: 'fixed',
			orderSignature: 'optional',
		})
		expect(resolveOptions({ adapters, revenue: { currency: 'EUR' } }).revenue.currency).toBe('EUR')
	})

	it('refuses a currency that is not an ISO 4217 code', () => {
		expect(() => resolveOptions({ adapters, revenue: { currency: 'eur' } })).toThrow(
			/revenue.currency/
		)
		expect(() => resolveOptions({ adapters, revenue: { currency: 42 as never } })).toThrow(
			/revenue.currency/
		)
	})

	it('refuses a value that is neither a boolean nor an object, and a converter that is no function', () => {
		expect(() => resolveOptions({ adapters, revenue: 'on' as never })).toThrow(
			/revenue must be true, false or an object/
		)
		expect(() => resolveOptions({ adapters, revenue: { convert: 'fx' as never } })).toThrow(
			/revenue.convert/
		)
	})

	it("takes revenue.browserAmounts as one of 'none', 'fixed' and 'trust', 'fixed' when unset", () => {
		for (const mode of ['none', 'fixed', 'trust'] as const) {
			expect(
				resolveOptions({ adapters, revenue: { browserAmounts: mode } }).revenue.browserAmounts
			).toBe(mode)
		}
		expect(() => resolveOptions({ adapters, revenue: { browserAmounts: 'all' as never } })).toThrow(
			/revenue\.browserAmounts must be 'none', 'fixed', 'trust', got "all"/
		)
		expect(() => resolveOptions({ adapters, revenue: { browserAmounts: true as never } })).toThrow(
			/revenue\.browserAmounts must be/
		)
	})

	// A converted install sums one currency, so the per-currency cut answers nothing new.
	it('turns the currency dimension off with a convert hook, and on otherwise unless told', () => {
		expect(resolveOptions({ adapters, revenue: { currency: 'EUR' } }).revenue.dimension).toBe(true)
		expect(
			resolveOptions({ adapters, revenue: { currency: 'EUR', convert: () => 1 } }).revenue.dimension
		).toBe(false)
		expect(resolveOptions({ adapters, revenue: { dimension: false } }).revenue.dimension).toBe(
			false
		)
		expect(
			resolveOptions({ adapters, revenue: { convert: () => 1, dimension: true } }).revenue.dimension
		).toBe(true)
	})
})

describe('revenueOffWarning', () => {
	it('names every config goal whose value reports nothing while money is off', () => {
		const warning = revenueOffWarning(resolveOptions({ adapters, goals: valued }))
		expect(warning).toMatch(/revenue is off/)
		expect(warning).toContain('"demo"')
		expect(warning).toContain('"lead"')
		expect(warning).not.toContain('"signup"')
	})

	it('says nothing while money is on, or when no goal carries a value', () => {
		expect(revenueOffWarning(resolveOptions({ adapters, goals: valued, revenue: true }))).toBeNull()
		expect(revenueOffWarning(resolveOptions({ adapters, goals: [valued[1] as Goal] }))).toBeNull()
		expect(revenueOffWarning(resolveOptions({ adapters }))).toBeNull()
	})
})

describe('withoutRevenue', () => {
	it('drops the metric from every adapter and leaves the rest alone', () => {
		const rich = { ...memoryAdapter(), id: 'rich' }
		rich.capabilities = { ...rich.capabilities, metrics: new Set(['pageviews', 'revenue']) }
		const registry = withoutRevenue(createRegistry([rich], 'rich'))
		expect(registry.get('rich').capabilities.metrics.has('revenue')).toBe(false)
		expect(registry.get('rich').capabilities.metrics.has('pageviews')).toBe(true)
		expect(registry.default().id).toBe('rich')
	})

	it('returns the same registry when nothing declared revenue', () => {
		const registry = createRegistry([memoryAdapter()])
		expect(withoutRevenue(registry)).toBe(registry)
	})

	it('narrows one adapter to one object however many registries are built, so its lane stays one', () => {
		const rich = { ...memoryAdapter(), id: 'rich' }
		rich.capabilities = { ...rich.capabilities, metrics: new Set(['pageviews', 'revenue']) }
		const first = withoutRevenue(createRegistry([rich], 'rich')).get('rich')
		const second = withoutRevenue(createRegistry([rich], 'rich')).get('rich')
		expect(second).toBe(first)
		expect(second).not.toBe(rich)
	})
})

describe('native revenue capability', () => {
	const registered = (revenue: { enabled: boolean; dimension: boolean }) => {
		const adapter = native()
		adapter.register?.({} as Config, {
			scoped: false,
			resolveScope: async () => null,
			resolveTimezone: async () => 'UTC',
			resolveTimezoneStrict: async () => 'UTC',
			revenue: { ...revenue, currency: async () => undefined },
			resolveGoals: async () => [],
		})
		return adapter.capabilities
	}

	it('declares revenue and the currency dimension while money is on', () => {
		const caps = registered({ enabled: true, dimension: true })
		expect(caps.metrics.has('revenue')).toBe(true)
		expect(caps.dimensions.has('currency')).toBe(true)
		expect(filterOperatorsFor(caps, 'currency')).toEqual(['eq', 'contains'])
	})

	it('declares neither while money is off', () => {
		const caps = registered({ enabled: false, dimension: false })
		expect(caps.metrics.has('revenue')).toBe(false)
		expect(caps.dimensions.has('currency')).toBe(false)
	})

	it('keeps revenue but drops the dimension when the install turned only that off', () => {
		const caps = registered({ enabled: true, dimension: false })
		expect(caps.metrics.has('revenue')).toBe(true)
		expect(caps.dimensions.has('currency')).toBe(false)
	})
})

describe('money off in the admin', () => {
	const metricOptions = (revenue: boolean): unknown[] => {
		const config = {} as Config
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			// The branch that offers the whole contract rather than a config-adapter union.
			providersEnabled: true,
			revenue,
			disabled: [],
			register: [],
		})
		const widget = config.admin?.dashboard?.widgets?.find((w) => w.slug === 'analytics-metric')
		const field = findMetricField(widget?.fields ?? [])
		return field && 'options' in field ? field.options : []
	}

	it('drops revenue from the multi-provider metric picker', () => {
		const values = (metricOptions(false) as Array<{ value: string }>).map((o) => o.value)
		expect(values).not.toContain('revenue')
		expect((metricOptions(true) as Array<{ value: string }>).map((o) => o.value)).toContain(
			'revenue'
		)
	})

	it('hides the goal amount and its currency without removing their fields', () => {
		const collection = buildGoalsCollection({
			slug: 'analytics-goals',
			revenue: false,
			scoped: false,
			scopeField: 'scope',
			resolveScope: async () => null,
			crossScope: async () => true,
			onChange: () => {},
		})
		for (const name of ['value', 'currency']) {
			const field = collection.fields.find(
				(candidate) => 'name' in candidate && candidate.name === name
			)
			expect(field).toBeDefined()
			expect(
				field?.admin?.condition?.(
					{},
					{},
					{
						blockData: {},
						operation: 'update',
						path: [],
						user: null,
					}
				)
			).toBe(false)
		}
	})
})
