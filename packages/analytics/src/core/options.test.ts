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

describe('resolveOptions widgets.localizeText', () => {
	const adapters = [memoryAdapter()]
	it('defaults localizeText to false for boolean and object forms', () => {
		expect(resolveOptions({ adapters }).widgets.localizeText).toBe(false)
		expect(resolveOptions({ adapters, widgets: true }).widgets.localizeText).toBe(false)
		expect(resolveOptions({ adapters, widgets: {} }).widgets.localizeText).toBe(false)
	})
	it('carries localizeText through from an object option', () => {
		expect(resolveOptions({ adapters, widgets: { localizeText: true } }).widgets.localizeText).toBe(
			true
		)
	})
})

describe('resolveOptions', () => {
	it('leaves cache TTL unset so the adapter recommendedTtl applies', () => {
		const r = resolveOptions({ adapters: [memoryAdapter()] })
		expect(r.cache.ttl.aggregate).toBeUndefined()
		expect(r.cache.ttl.realtime).toBeUndefined()
	})
	it('keeps an explicit cache TTL override', () => {
		const r = resolveOptions({
			adapters: [memoryAdapter()],
			cache: { ttl: { aggregate: 1800, realtime: 30 } },
		})
		expect(r.cache.ttl.aggregate).toBe(1800)
		expect(r.cache.ttl.realtime).toBe(30)
	})
	it('throws when no adapters are supplied', () => {
		expect(() => resolveOptions({ adapters: [] })).toThrow(/at least one adapter/i)
	})
})

describe('resolveOptions providers', () => {
	const adapters = [memoryAdapter()]

	it('defaults to a disabled collection with the default slug and scope field', () => {
		const p = resolveOptions({ adapters }).providers
		expect(p.collection).toEqual({
			enabled: false,
			slug: 'analytics-providers',
			scopeField: 'scope',
		})
		expect(p.resolve).toBeUndefined()
	})

	it('enables the collection with defaults when collection is true', () => {
		const p = resolveOptions({ adapters, providers: { collection: true } }).providers
		expect(p.collection.enabled).toBe(true)
		expect(p.collection.slug).toBe('analytics-providers')
		expect(p.collection.scopeField).toBe('scope')
	})

	it('keeps the collection disabled when collection is false', () => {
		const p = resolveOptions({ adapters, providers: { collection: false } }).providers
		expect(p.collection.enabled).toBe(false)
	})

	it('carries slug, scopeField, access, and overrides through from an object option', () => {
		const overrides = (c: import('payload').CollectionConfig) => c
		const access = { read: () => true }
		const p = resolveOptions({
			adapters,
			providers: {
				collection: { slug: 'tenant-analytics', scopeField: 'tenant', overrides, access },
			},
		}).providers
		expect(p.collection).toEqual({
			enabled: true,
			slug: 'tenant-analytics',
			scopeField: 'tenant',
			overrides,
			access,
		})
	})

	it('carries the resolve escape hatch through', () => {
		const resolve = async () => []
		expect(resolveOptions({ adapters, providers: { resolve } }).providers.resolve).toBe(resolve)
	})
})

describe('resolveOptions scopeResolver', () => {
	const adapters = [memoryAdapter()]
	const req = {} as import('payload').PayloadRequest

	it('defaults to resolving null for every request', async () => {
		const resolved = resolveOptions({ adapters })
		expect(await resolved.scopeResolver({ req })).toBeNull()
		expect(resolved.scoped).toBe(false)
	})

	it('carries a custom resolver through, sync or async, and marks the install scoped', async () => {
		const sync = resolveOptions({ adapters, scopeResolver: () => 'tenant-a' })
		expect(await sync.scopeResolver({ req })).toBe('tenant-a')
		expect(sync.scoped).toBe(true)
		const async = resolveOptions({ adapters, scopeResolver: async () => 'tenant-b' })
		expect(await async.scopeResolver({ req })).toBe('tenant-b')
	})
})

describe('resolveOptions platformAdapter and access', () => {
	const adapters = [memoryAdapter()]

	it('accepts a platformAdapter naming a config adapter', () => {
		expect(resolveOptions({ adapters, platformAdapter: 'memory' }).platformAdapter).toBe('memory')
	})

	it('throws for a platformAdapter naming no config adapter', () => {
		expect(() => resolveOptions({ adapters, platformAdapter: 'posthog' })).toThrow(
			/unknown platform adapter/i
		)
	})

	it('defaults platformRead to any authenticated user', async () => {
		const { platformRead } = resolveOptions({ adapters }).access
		expect(await platformRead({ req: { user: { id: 1 } } as never })).toBe(true)
		expect(await platformRead({ req: { user: null } as never })).toBe(false)
	})

	it('carries a custom platformRead through', async () => {
		const platformRead = () => false
		expect(resolveOptions({ adapters, access: { platformRead } }).access.platformRead).toBe(
			platformRead
		)
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

describe('resolveOptions sync', () => {
	const adapters = [memoryAdapter()]
	it('defaults sync to disabled with default slug/cron/lookback when unset', () => {
		expect(resolveOptions({ adapters }).sync).toEqual({
			enabled: false,
			collectionSlug: 'analytics-daily',
			cron: '0 */6 * * *',
			lookbackDays: 3,
		})
	})
	it('enables sync with defaults when sync is true', () => {
		expect(resolveOptions({ adapters, sync: true }).sync).toEqual({
			enabled: true,
			collectionSlug: 'analytics-daily',
			cron: '0 */6 * * *',
			lookbackDays: 3,
		})
	})
	it('keeps sync disabled when sync is false', () => {
		expect(resolveOptions({ adapters, sync: false }).sync.enabled).toBe(false)
	})
	it('fills per-field defaults and carries adapters from an object option', () => {
		expect(
			resolveOptions({ adapters, sync: { cron: '0 0 * * *', adapters: ['plausible'] } }).sync
		).toEqual({
			enabled: true,
			collectionSlug: 'analytics-daily',
			cron: '0 0 * * *',
			lookbackDays: 3,
			adapters: ['plausible'],
		})
	})
	it('overrides slug and lookbackDays from an object option', () => {
		const sync = resolveOptions({
			adapters,
			sync: { collectionSlug: 'metrics', lookbackDays: 7 },
		}).sync
		expect(sync.collectionSlug).toBe('metrics')
		expect(sync.lookbackDays).toBe(7)
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
