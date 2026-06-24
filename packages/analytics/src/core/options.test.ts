import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveOptions } from './options'

describe('resolveOptions widgets.register', () => {
	const adapters = [memoryAdapter()]
	it('defaults register to [] when widgets is true/undefined', () => {
		expect(resolveOptions({ adapters }).widgets.register).toEqual([])
		expect(resolveOptions({ adapters, widgets: true }).widgets.register).toEqual([])
	})
	it('carries register through from an object option', () => {
		const reg = [{ slug: 'myapp-x', component: '@/x#default', label: 'X' }]
		expect(resolveOptions({ adapters, widgets: { register: reg } }).widgets.register).toEqual(reg)
	})
	it('keeps register [] and enabled false when widgets is false', () => {
		const w = resolveOptions({ adapters, widgets: false }).widgets
		expect(w.enabled).toBe(false)
		expect(w.register).toEqual([])
	})
})

describe('resolveOptions', () => {
	it('fills cache TTL defaults', () => {
		const r = resolveOptions({ adapters: [memoryAdapter()] })
		expect(r.cache.ttl.aggregate).toBeGreaterThan(0)
		expect(r.cache.ttl.realtime).toBeGreaterThan(0)
	})
	it('throws when no adapters are supplied', () => {
		expect(() => resolveOptions({ adapters: [] })).toThrow(/at least one adapter/i)
	})
})

describe('resolveOptions cache.warm', () => {
	const adapters = [memoryAdapter()]
	it('defaults warm to disabled with the default cron when cache.warm is unset', () => {
		const warm = resolveOptions({ adapters }).cache.warm
		expect(warm).toEqual({ enabled: false, cron: '*/30 * * * *' })
	})
	it('enables warm with the default cron when cache.warm is true', () => {
		expect(resolveOptions({ adapters, cache: { warm: true } }).cache.warm).toEqual({
			enabled: true,
			cron: '*/30 * * * *',
		})
	})
	it('keeps warm disabled when cache.warm is false', () => {
		expect(resolveOptions({ adapters, cache: { warm: false } }).cache.warm.enabled).toBe(false)
	})
	it('enables warm with a custom cron from an object option', () => {
		expect(resolveOptions({ adapters, cache: { warm: { cron: '0 * * * *' } } }).cache.warm).toEqual(
			{
				enabled: true,
				cron: '0 * * * *',
			}
		)
	})
	it('enables warm with the default cron when the object omits cron', () => {
		expect(resolveOptions({ adapters, cache: { warm: {} } }).cache.warm.cron).toBe('*/30 * * * *')
	})
})

describe('resolveOptions bindings', () => {
	const adapter = memoryAdapter()

	it('defaults bindings to an empty object', () => {
		expect(resolveOptions({ adapters: [adapter] }).bindings).toEqual({})
	})

	it('passes through a resolver binding', () => {
		const path = (doc: Record<string, unknown>) => `/${doc.slug as string}`
		const resolved = resolveOptions({ adapters: [adapter], collections: { pages: { path } } })
		expect(resolved.bindings.pages?.path).toBe(path)
	})

	it('accepts a pathField-only binding', () => {
		const resolved = resolveOptions({
			adapters: [adapter],
			collections: { posts: { pathField: 'permalink' } },
		})
		expect(resolved.bindings.posts?.pathField).toBe('permalink')
	})

	it('throws when a binding has neither path nor pathField', () => {
		expect(() => resolveOptions({ adapters: [adapter], collections: { pages: {} } })).toThrow(
			/pages.*path.*pathField/i
		)
	})
})
