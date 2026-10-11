import type { CollectionConfig, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { posthog } from '../adapters/posthog/posthog'
import type { Goal } from '../goals/types'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { DEFAULT_JOBS } from './jobs'
import type { AnalyticsPluginOptions, CaptureGateArgs } from './options'
import {
	fillableSlots,
	resolveOptions,
	trackerAutoCapture,
	untrustedAddressNotice,
} from './options'

const adapters = [memoryAdapter()]
const scope = { resolve: () => 'tenant-a', member: () => true }
const req = {} as PayloadRequest
const adminConfig = { config: { admin: { user: 'users' } } }
const signedIn = {
	user: { id: 1, collection: 'users' },
	payload: adminConfig,
} as unknown as PayloadRequest
const customer = {
	user: { id: 2, collection: 'customers' },
	payload: adminConfig,
} as unknown as PayloadRequest
const anonymous = { user: null, payload: adminConfig } as unknown as PayloadRequest

const ph = () => posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' })

describe('resolveOptions widgets.register', () => {
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

describe('resolveOptions cache storage', () => {
	it('stores reads in the analytics-cache collection unless told otherwise', () => {
		const { cache } = resolveOptions({ adapters })
		expect(cache.store).toBeUndefined()
		expect(cache.collection).toEqual({ slug: 'analytics-cache' })
	})

	it('takes a slug and an overrides function for the collection', () => {
		const overrides = (collection: CollectionConfig) => collection
		const { cache } = resolveOptions({
			adapters,
			cache: { collection: { slug: ' reads ', overrides } },
		})
		expect(cache.collection).toEqual({ slug: 'reads', overrides })
		expect(() => resolveOptions({ adapters, cache: { collection: { slug: ' ' } } })).toThrow(
			/cache\.collection\.slug/
		)
	})

	it("takes the host's store, and refuses one missing a method or set beside the collection", () => {
		const store = memoryCacheStore()
		expect(resolveOptions({ adapters, cache: { store } }).cache.store).toBe(store)
		const { sweep: _sweep, ...partial } = store
		expect(() =>
			resolveOptions({ adapters, cache: { store: partial as unknown as typeof store } })
		).toThrow(/cache\.store must be an object with get, set, touch, sweep and recentRecipes/)
		expect(() =>
			resolveOptions({ adapters, cache: { store, collection: { slug: 'reads' } } })
		).toThrow(/cache\.store replaces/)
	})
})

describe('resolveOptions', () => {
	it('leaves cache TTL unset so the adapter recommendedTtl applies', () => {
		const r = resolveOptions({ adapters })
		expect(r.cache.ttl.aggregate).toBeUndefined()
		expect(r.cache.ttl.realtime).toBeUndefined()
	})
	it('keeps an explicit cache TTL override', () => {
		const r = resolveOptions({ adapters, cache: { ttl: { aggregate: 1800, realtime: 30 } } })
		expect(r.cache.ttl.aggregate).toBe(1800)
		expect(r.cache.ttl.realtime).toBe(30)
	})
	it('throws when no adapters are supplied', () => {
		expect(() => resolveOptions({ adapters: [] })).toThrow(/at least one adapter/i)
	})
	it('defaults cache.timeoutMs to 15000', () => {
		expect(resolveOptions({ adapters }).cache.timeoutMs).toBe(15_000)
	})
	it('keeps an explicit cache.timeoutMs override', () => {
		expect(resolveOptions({ adapters, cache: { timeoutMs: 5_000 } }).cache.timeoutMs).toBe(5_000)
	})
	it('defaults cache.concurrency to 16 in all, 4 per source and 8 cold reads per scope', () => {
		expect(resolveOptions({ adapters }).cache.concurrency).toEqual({
			global: 16,
			perSource: 4,
			perScope: 8,
		})
		expect(
			resolveOptions({ adapters, cache: { concurrency: { perSource: 2, perScope: 20 } } }).cache
				.concurrency
		).toEqual({ global: 16, perSource: 2, perScope: 20 })
	})
	it.each([0, -1, 1.5, '4'])('refuses %j as a cache.concurrency count', (value) => {
		expect(() =>
			// @ts-expect-error a count of the wrong kind, as a JavaScript caller can pass
			resolveOptions({ adapters, cache: { concurrency: { global: value } } })
		).toThrow(/cache\.concurrency\.global must be a whole number of 1 or more/)
	})
	it('takes hooks.afterRead as a function and nothing else', () => {
		const afterRead = () => undefined
		expect(resolveOptions({ adapters, hooks: { afterRead } }).hooks).toEqual({ afterRead })
		expect(resolveOptions({ adapters }).hooks).toEqual({})
		expect(() =>
			// @ts-expect-error a hook that is not a function
			resolveOptions({ adapters, hooks: { afterRead: 'log' } })
		).toThrow(/hooks\.afterRead must be a function/)
	})
	it.each([0, -5, 2.5, '15000'])('refuses %j as cache.timeoutMs', (value) => {
		expect(() =>
			// @ts-expect-error a timeout of the wrong kind, as a JavaScript caller can pass
			resolveOptions({ adapters, cache: { timeoutMs: value } })
		).toThrow(/cache\.timeoutMs must be a whole number of 1 or more/)
	})
	it.each([
		[{ cache: { timeout: 5_000 } }, 'cache.timeout is not an option; cache takes ttl, warm,'],
		[{ cache: { ttl: { fresh: 60 } } }, 'cache.ttl.fresh is not an option; cache.ttl takes'],
		[
			{ cache: { concurrency: { perTenant: 2 } } },
			'cache.concurrency.perTenant is not an option; cache.concurrency takes global, perSource and perScope',
		],
		[
			{ cache: { warm: { window: 6 } } },
			'cache.warm.window is not an option; cache.warm takes windowHours and maxReads',
		],
		[
			{ hooks: { beforeRead: () => undefined } },
			'hooks.beforeRead is not an option; hooks takes afterRead',
		],
	])('refuses a key the option does not take: %j', (extra, message) => {
		expect(() => resolveOptions({ adapters, ...(extra as object) })).toThrow(message)
	})
	it('refuses a cache that is not an object', () => {
		expect(() => resolveOptions({ adapters, cache: [] as never })).toThrow(
			/cache must be an object such as \{ timeoutMs: 15000 \}, got an array/
		)
	})
	it('leaves trustedProxyHops unset so the leftmost forwarded-for entry keeps applying', () => {
		expect(resolveOptions({ adapters }).trustedProxyHops).toBeUndefined()
	})
	it('keeps an explicit trustedProxyHops count', () => {
		expect(resolveOptions({ adapters, trustedProxyHops: 2 }).trustedProxyHops).toBe(2)
	})
	it('throws on a trustedProxyHops that is not a non-negative integer', () => {
		for (const hops of [-1, 1.5, Number.NaN]) {
			expect(() => resolveOptions({ adapters, trustedProxyHops: hops })).toThrow(
				/trustedProxyHops must be a non-negative integer/i
			)
		}
	})
	it('refuses a renamed option before reading anything else', () => {
		const options = { adapters, scopeResolver: () => null }
		expect(() => resolveOptions(options)).toThrow(/scopeResolver.*scope\.resolve/)
	})
})

describe('resolveOptions scope', () => {
	const admin = { req, callSite: 'admin' as const }
	const member = () => true

	it('resolves every request to the install-wide scope when unset', async () => {
		const resolved = resolveOptions({ adapters })
		expect(await resolved.scope.resolve(admin)).toBeNull()
		expect(resolved.scoped).toBe(false)
		expect(resolved.scope.list).toBeUndefined()
		expect(resolved.scope.label).toBeUndefined()
		expect(resolved.scope.member).toBeUndefined()
	})

	it('carries a resolver through, sync or async, and marks the install scoped', async () => {
		const sync = resolveOptions({ adapters, scope: { resolve: () => 'tenant-a', member } })
		expect(await sync.scope.resolve(admin)).toBe('tenant-a')
		expect(sync.scoped).toBe(true)
		const async = resolveOptions({ adapters, scope: { resolve: async () => 'tenant-b', member } })
		expect(await async.scope.resolve(admin)).toBe('tenant-b')
		const none = resolveOptions({ adapters, scope: { resolve: () => null, member } })
		expect(await none.scope.resolve(admin)).toBeNull()
	})

	it('hands the resolver the call site it is asked from', async () => {
		const seen: string[] = []
		const resolved = resolveOptions({
			adapters,
			scope: {
				resolve: ({ callSite }) => {
					seen.push(callSite)
					return null
				},
				member,
			},
		})
		await resolved.scope.resolve(admin)
		await resolved.scope.resolve({ req, callSite: 'capture' })
		expect(seen).toEqual(['admin', 'capture'])
	})

	// Selecting a scope is not belonging to it; a resolver without a membership check would let
	// a tenant selector pointed at someone else's tenant read it.
	it('requires member alongside resolve, naming the helper and the opt-out', () => {
		const missing = { resolve: () => 'tenant-a' } as never
		expect(() => resolveOptions({ adapters, scope: missing })).toThrow(
			/scope\.member is required with scope\.resolve/
		)
		expect(() => resolveOptions({ adapters, scope: missing })).toThrow(/tenantMembership\(\)/)
		expect(() => resolveOptions({ adapters, scope: missing })).toThrow(/\(\) => true/)
	})

	it('carries list, label and member through unchanged', () => {
		const list = () => ['t1', 't2']
		const label = () => 'One'
		const member = () => true
		const resolved = resolveOptions({ adapters, scope: { ...scope, list, label, member } })
		expect(resolved.scope.list).toBe(list)
		expect(resolved.scope.label).toBe(label)
		expect(resolved.scope.member).toBe(member)
	})

	// The wildcard is a reader's request for every scope; a resolver answering it would hand
	// every request the aggregate without any gate having been asked.
	it("refuses a resolver answering '*' at runtime", async () => {
		const resolved = resolveOptions({ adapters, scope: { resolve: () => '*', member } })
		await expect(resolved.scope.resolve(admin)).rejects.toThrow(/scope\.resolve returned "\*"/)
		const async = resolveOptions({ adapters, scope: { resolve: async () => '*', member } })
		await expect(async.scope.resolve(admin)).rejects.toThrow(/names every scope/)
	})

	it('refuses a resolver, list, label or member that is not a function', () => {
		const bad = 'tenant' as never
		expect(() => resolveOptions({ adapters, scope: { resolve: bad, member } })).toThrow(
			/scope\.resolve must be a function/
		)
		expect(() => resolveOptions({ adapters, scope: { ...scope, list: bad } })).toThrow(
			/scope\.list must be a function/
		)
		expect(() => resolveOptions({ adapters, scope: { ...scope, label: bad } })).toThrow(
			/scope\.label must be a function/
		)
		expect(() => resolveOptions({ adapters, scope: { ...scope, member: bad } })).toThrow(
			/scope\.member must be a function/
		)
	})
})

describe('resolveOptions options that need scope.resolve', () => {
	const unscoped = (options: Partial<AnalyticsPluginOptions>) => () =>
		resolveOptions({ adapters, ...options })

	it.each([
		['scope.list', { scope: { list: () => [] } as never }],
		['scope.label', { scope: { label: () => 'x' } as never }],
		['scope.member', { scope: { member: () => true } as never }],
		['access.crossScope', { access: { crossScope: () => true } }],
		['access.crossScope', { access: { crossScope: { named: () => true } } }],
		[
			'collections.pages.scopeField',
			{ collections: { pages: { pathField: 'slug', scopeField: 'tenant' } } },
		],
		['goals.collection.scopeField', { goals: { collection: { scopeField: 'tenant' } } }],
		['providers.collection.scopeField', { providers: { collection: { scopeField: 'tenant' } } }],
		['capture.slots.tenant', { capture: { slots: { tenant: 'posthog:abc' } } }],
		['capture.paths.tenant', { capture: { paths: { tenant: '/ph' } } }],
	])('throws for %s on an unscoped install', (path, options) => {
		expect(unscoped(options)).toThrow(new RegExp(`${path.replaceAll('.', '\\.')}.*scope\\.resolve`))
	})

	it('names every offending option in one error', () => {
		expect(
			unscoped({
				access: { crossScope: () => true },
				collections: { pages: { pathField: 'slug', scopeField: 'tenant' } },
			})
		).toThrow(/access\.crossScope, collections\.pages\.scopeField only apply to a scoped install/)
	})

	it('accepts the false forms, which ask for nothing a scope would give', () => {
		expect(
			unscoped({
				collections: { pages: { pathField: 'slug', scopeField: false } },
				capture: { slots: { tenant: false } },
			})
		).not.toThrow()
	})

	it('accepts every one of them once scope.resolve is set', () => {
		expect(() =>
			resolveOptions({
				adapters,
				scope: { ...scope, list: () => [], label: () => 'x', member: () => true },
				access: { crossScope: () => true },
				collections: { pages: { pathField: 'slug', scopeField: 'tenant' } },
				goals: { collection: { scopeField: 'tenant' } },
				providers: { collection: { scopeField: 'tenant' } },
				capture: { slots: { tenant: 'posthog:abc' }, paths: { tenant: '/ph' }, gate: 'all' },
			})
		).not.toThrow()
	})
})

describe('resolveOptions reportingTimezone', () => {
	it('keeps a valid IANA name and a resolver as given', () => {
		expect(resolveOptions({ adapters, reportingTimezone: 'Europe/Berlin' }).reportingTimezone).toBe(
			'Europe/Berlin'
		)
		const resolver = () => 'Europe/Berlin'
		expect(resolveOptions({ adapters, reportingTimezone: resolver }).reportingTimezone).toBe(
			resolver
		)
		expect(resolveOptions({ adapters }).reportingTimezone).toBeUndefined()
	})

	// A typo would otherwise read every window in UTC without a word.
	it('refuses a string that is not an IANA timezone name', () => {
		for (const zone of ['Europe/Berlinn', 'CEST+1', '']) {
			expect(() => resolveOptions({ adapters, reportingTimezone: zone })).toThrow(
				/reportingTimezone .* is not an IANA timezone name/
			)
		}
	})

	it('refuses a value that is neither a string nor a function', () => {
		expect(() => resolveOptions({ adapters, reportingTimezone: 1 as never })).toThrow(
			/reportingTimezone must be an IANA timezone or a function/
		)
	})
})

describe('resolveOptions platformAdapter', () => {
	it('accepts a platformAdapter naming a config adapter', () => {
		expect(resolveOptions({ adapters, platformAdapter: 'memory' }).platformAdapter).toBe('memory')
	})

	it('throws for a platformAdapter naming no config adapter', () => {
		expect(() => resolveOptions({ adapters, platformAdapter: 'posthog' })).toThrow(
			/platformAdapter "posthog" names no adapter in adapters, whose ids are "memory"/
		)
	})
})

describe('resolveOptions access.crossScope', () => {
	const gatesOf = async (options: Partial<AnalyticsPluginOptions>, on: PayloadRequest) => {
		const { crossScope } = resolveOptions({ adapters, ...options }).access
		return [
			await crossScope.named({ req: on }),
			await crossScope.aggregate({ req: on }),
			await crossScope.unscopedSource({ req: on }),
		]
	}

	it('lets the admin collection through on an unscoped install, and nobody else', async () => {
		expect(await gatesOf({}, signedIn)).toEqual([true, true, true])
		expect(await gatesOf({}, customer)).toEqual([false, false, false])
		expect(await gatesOf({}, anonymous)).toEqual([false, false, false])
	})

	it('denies all three on a scoped install that says nothing', async () => {
		expect(await gatesOf({ scope }, signedIn)).toEqual([false, false, false])
	})

	it('grants all three with the function form', async () => {
		const crossScope = () => true
		const resolved = resolveOptions({ adapters, scope, access: { crossScope } }).access.crossScope
		expect(resolved).toEqual({
			named: crossScope,
			aggregate: crossScope,
			unscopedSource: crossScope,
		})
	})

	it('decides each gate separately with the object form, denying the ones it leaves out', async () => {
		const options = { scope, access: { crossScope: { aggregate: () => true } } }
		expect(await gatesOf(options, signedIn)).toEqual([false, true, false])
		const unscopedSource = { scope, access: { crossScope: { unscopedSource: () => true } } }
		expect(await gatesOf(unscopedSource, signedIn)).toEqual([false, false, true])
	})

	// `platformAdapter` was the gate's name under `access.scopes`; renaming only the outer key
	// would otherwise drop it without a word.
	it('refuses a gate it does not know, naming the three it has', () => {
		expect(() =>
			resolveOptions({
				adapters,
				scope,
				access: { crossScope: { platformAdapter: () => true } as never },
			})
		).toThrow(/no "platformAdapter" gate; the gates are named, aggregate and unscopedSource/)
	})

	it('refuses a gate that is not a function, and a value that is neither form', () => {
		expect(() =>
			resolveOptions({ adapters, scope, access: { crossScope: { named: true } as never } })
		).toThrow(/access\.crossScope\.named must be a function/)
		expect(() =>
			resolveOptions({ adapters, scope, access: { crossScope: 'staff' as never } })
		).toThrow(/access\.crossScope must be a function or an object/)
	})
})

describe('resolveOptions access.read and access.view', () => {
	it('defaults read to the admin collection and view to the same function', async () => {
		const { access } = resolveOptions({ adapters })
		expect(await access.read({ req: signedIn })).toBe(true)
		expect(await access.read({ req: customer })).toBe(false)
		expect(await access.read({ req: anonymous })).toBe(false)
		expect(access.view).toBe(access.read)
	})

	it('keeps an explicit access.view separate from access.read', () => {
		const view = () => false
		const resolved = resolveOptions({ adapters, access: { view } })
		expect(resolved.access.view).toBe(view)
		expect(resolved.access.read).not.toBe(view)
	})
})

describe('resolveOptions providers', () => {
	const vendorClouds = { allow: [], allowPrivateNetwork: false }

	it('defaults to a disabled collection with the default slug and scope field', () => {
		const p = resolveOptions({ adapters }).providers
		expect(p.collection).toEqual({
			enabled: false,
			slug: 'analytics-providers',
			scopeField: 'scope',
		})
		expect(p.hosts).toEqual(vendorClouds)
		expect(p.resolve).toBeUndefined()
	})

	it('enables the collection with defaults when collection is true', () => {
		const p = resolveOptions({ adapters, providers: { collection: true } }).providers
		expect(p.collection).toEqual({
			enabled: true,
			slug: 'analytics-providers',
			scopeField: 'scope',
		})
		expect(p.hosts).toEqual(vendorClouds)
	})

	const wideHosts = {
		allow: ['https://analytics.example.com', 'http://*.svc.local'],
		allowPrivateNetwork: true,
	}

	const wideHostsResolved = {
		allow: [
			{ kind: 'exact', origin: 'https://analytics.example.com' },
			{ kind: 'subdomains', protocol: 'http:', port: '', suffix: 'svc.local' },
		],
		allowPrivateNetwork: true,
	}

	it('resolves providers.hosts and both access functions for the collection', () => {
		const connectionAccess = () => true
		const sourceAccess = () => true
		const p = resolveOptions({
			adapters,
			providers: { collection: { connectionAccess, sourceAccess }, hosts: wideHosts },
		}).providers
		expect(p.hosts).toEqual(wideHostsResolved)
		expect(p.collection.connectionAccess).toEqual({
			create: connectionAccess,
			update: connectionAccess,
		})
		expect(p.collection.sourceAccess).toBe(sourceAccess)
	})

	it('resolves providers.hosts for providers.resolve too', () => {
		const resolve = async () => []
		expect(
			resolveOptions({ adapters, providers: { resolve, hosts: wideHosts } }).providers.hosts
		).toEqual(wideHostsResolved)
	})

	it('refuses providers.hosts with neither the collection nor resolve to apply to', () => {
		for (const providers of [{ hosts: wideHosts }, { collection: false, hosts: wideHosts }]) {
			expect(() => resolveOptions({ adapters, providers })).toThrow(
				/providers\.hosts only applies to provider documents/
			)
		}
	})

	it('fails the boot on a hosts entry that is not an origin it can match', () => {
		const withAllow = (allow: string[]) => () =>
			resolveOptions({ adapters, providers: { collection: true, hosts: { allow } } })
		expect(withAllow(['https://analytics.example.com/api'])).toThrow(
			/providers\.hosts\.allow entry "https:\/\/analytics\.example\.com\/api"/
		)
		expect(withAllow(['http://analytics.example.com'])).toThrow(
			/providers\.hosts\.allowPrivateNetwork/
		)
		expect(withAllow(['https://*.com'])).toThrow(/top-level domain/)
	})

	it('keeps each half of an object connectionAccess, and leaves out the one it omits', () => {
		const create = () => true
		const update = () => false
		const resolved = (connectionAccess: Record<string, unknown>) =>
			resolveOptions({
				adapters,
				providers: { collection: { connectionAccess: connectionAccess as never } },
			}).providers.collection.connectionAccess
		expect(resolved({ create, update })).toEqual({ create, update })
		expect(resolved({ update })).toEqual({ update })
		expect(resolved({})).toEqual({})
	})

	it('fails the boot on access options of the wrong shape', () => {
		const withCollection = (collection: Record<string, unknown>) => () =>
			resolveOptions({ adapters, providers: { collection: collection as never } })
		for (const connectionAccess of [true, null, [() => true]]) {
			expect(withCollection({ connectionAccess })).toThrow(
				/providers\.collection\.connectionAccess must be a function, or \{ create, update \}/
			)
		}
		expect(withCollection({ connectionAccess: { create: true } })).toThrow(
			/providers\.collection\.connectionAccess\.create must be a field access function, got boolean/
		)
		expect(withCollection({ connectionAccess: { read: () => true } })).toThrow(
			/providers\.collection\.connectionAccess\.read is not an option/
		)
		expect(withCollection({ sourceAccess: 'admins' })).toThrow(
			/providers\.collection\.sourceAccess must be a function/
		)
	})

	it('keeps the collection disabled when collection is false', () => {
		expect(
			resolveOptions({ adapters, providers: { collection: false } }).providers.collection.enabled
		).toBe(false)
	})

	it('carries slug, scopeField, access, and overrides through from an object option', () => {
		const overrides = (c: CollectionConfig) => c
		const access = { read: () => true }
		const p = resolveOptions({
			adapters,
			scope,
			capture: { gate: 'all' },
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

	it('refuses resolve beside an enabled collection, naming both', () => {
		const resolve = async () => []
		for (const collection of [true, { slug: 'tenant-analytics' }]) {
			expect(() => resolveOptions({ adapters, providers: { resolve, collection } })).toThrow(
				/providers\.resolve and providers\.collection cannot both be set/
			)
		}
		expect(
			resolveOptions({ adapters, providers: { resolve, collection: false } }).providers.resolve
		).toBe(resolve)
	})

	it('throws when scopeField is empty, blank or dotted', () => {
		const withField = (scopeField: string) => () =>
			resolveOptions({
				adapters,
				scope,
				capture: { gate: 'all' },
				providers: { collection: { scopeField } },
			})
		expect(withField('')).toThrow(
			/providers\.collection\.scopeField must be a non-empty field name/
		)
		expect(withField('  ')).toThrow(/scopeField must be a non-empty field name/)
		expect(withField('tenant.id')).toThrow(/scopeField must be a top-level field name/)
		expect(withField('tenant')).not.toThrow()
	})
})

describe('resolveOptions cache.warm', () => {
	const defaults = { windowHours: 24, maxReads: 200 }

	it('keeps warming off by default and with false', () => {
		expect(resolveOptions({ adapters }).cache.warm).toEqual({ enabled: false, ...defaults })
		expect(resolveOptions({ adapters, cache: { warm: false } }).cache.warm.enabled).toBe(false)
	})

	it('turns it on with the defaults for true or an empty object', () => {
		expect(resolveOptions({ adapters, cache: { warm: true } }).cache.warm).toEqual({
			enabled: true,
			...defaults,
		})
		expect(resolveOptions({ adapters, cache: { warm: {} } }).cache.warm).toEqual({
			enabled: true,
			...defaults,
		})
	})

	it('takes how far back reads count and how many one run keeps warm', () => {
		expect(
			resolveOptions({ adapters, cache: { warm: { windowHours: 6, maxReads: 50 } } }).cache.warm
		).toEqual({ enabled: true, windowHours: 6, maxReads: 50 })
	})

	it('fails the boot on a window or a count that is not a whole number above zero', () => {
		expect(() => resolveOptions({ adapters, cache: { warm: { windowHours: 0 } } })).toThrow(
			/cache\.warm\.windowHours must be a whole number of 1 or more, got 0/
		)
		expect(() => resolveOptions({ adapters, cache: { warm: { maxReads: 2.5 } } })).toThrow(
			/cache\.warm\.maxReads must be a whole number/
		)
		expect(() => resolveOptions({ adapters, cache: { warm: 'yes' as never } })).toThrow(
			/cache\.warm must be true, false or an object/
		)
	})

	it('refuses the schedule it no longer takes, naming the jobs entry that does', () => {
		expect(() =>
			resolveOptions({ adapters, cache: { warm: { cron: '0 * * * *' } as never } })
		).toThrow(/cache\.warm\.cron was removed in 1\.0\.0-beta\.12, use jobs\.tasks\.warm\.cron/)
	})
})

describe('resolveOptions sync', () => {
	const defaults = {
		lookbackDays: 3,
		collection: { slug: 'analytics-daily', hidden: true },
	}

	it('defaults sync to disabled with the default collection and lookback', () => {
		expect(resolveOptions({ adapters }).sync).toEqual({ enabled: false, ...defaults })
		expect(resolveOptions({ adapters, sync: false }).sync).toEqual({ enabled: false, ...defaults })
	})

	it('enables sync with the defaults when sync is true', () => {
		expect(resolveOptions({ adapters, sync: true }).sync).toEqual({ enabled: true, ...defaults })
	})

	it('fills per-field defaults and carries adapters from an object option', () => {
		expect(resolveOptions({ adapters, sync: { adapters: ['plausible'] } }).sync).toEqual({
			...defaults,
			enabled: true,
			adapters: ['plausible'],
		})
	})

	it('refuses the schedule it no longer takes, and a lookback that is not a day count', () => {
		expect(() => resolveOptions({ adapters, sync: { cron: '0 0 * * *' } as never })).toThrow(
			/sync\.cron was removed in 1\.0\.0-beta\.12, use jobs\.tasks\.sync\.cron/
		)
		expect(() => resolveOptions({ adapters, sync: { lookbackDays: 0 } })).toThrow(
			/sync\.lookbackDays must be a whole number of 1 or more/
		)
	})

	it('reads the collection settings from sync.collection', () => {
		const overrides = (c: CollectionConfig) => c
		const sync = resolveOptions({
			adapters,
			sync: { lookbackDays: 7, collection: { slug: ' metrics ', hidden: false, overrides } },
		}).sync
		expect(sync.lookbackDays).toBe(7)
		expect(sync.collection).toEqual({ slug: 'metrics', hidden: false, overrides })
	})

	it('hides the sync collection by default', () => {
		expect(resolveOptions({ adapters, sync: { collection: {} } }).sync.collection.hidden).toBe(true)
	})

	it('throws on an empty collection slug', () => {
		expect(() => resolveOptions({ adapters, sync: { collection: { slug: ' ' } } })).toThrow(
			/sync\.collection\.slug must be a non-empty collection slug/
		)
	})
})

describe('resolveOptions bindings', () => {
	it('defaults bindings to an empty object', () => {
		expect(resolveOptions({ adapters }).bindings).toEqual({})
	})

	it('passes through a resolver binding', () => {
		const path = (doc: Record<string, unknown>) => `/${doc.slug as string}`
		const resolved = resolveOptions({ adapters, collections: { pages: { path } } })
		expect(resolved.bindings.pages?.path).toBe(path)
	})

	it('accepts a pathField-only binding', () => {
		const resolved = resolveOptions({
			adapters,
			collections: { posts: { pathField: 'permalink' } },
		})
		expect(resolved.bindings.posts?.pathField).toBe('permalink')
	})

	it('throws when a binding has neither path nor pathField', () => {
		expect(() => resolveOptions({ adapters, collections: { pages: {} } })).toThrow(
			/pages.*path.*pathField/i
		)
	})

	it('accepts a collection bound as items alone, with no path', () => {
		const resolved = resolveOptions({ adapters, collections: { offers: { item: true } } })
		expect(resolved.bindings.offers?.item).toBe(true)
	})

	it('refuses an item binding whose slug holds a colon, which a ref could not name', () => {
		expect(() =>
			resolveOptions({ adapters, collections: { 'shop:offers': { item: true } } })
		).toThrow(/colon/)
	})
})

describe('resolveOptions collections.<slug>.scopeField', () => {
	const scopeFieldOf = (options: Partial<AnalyticsPluginOptions>, binding = {}) =>
		resolveOptions({
			adapters,
			...options,
			collections: { pages: { pathField: 'slug', ...binding } },
		}).bindings.pages?.scopeField

	it("defaults to 'tenant' on a scoped install and to false otherwise", () => {
		expect(scopeFieldOf({ scope })).toBe('tenant')
		expect(scopeFieldOf({})).toBe(false)
	})

	it('keeps an explicit field name, and false, on a scoped install', () => {
		expect(scopeFieldOf({ scope }, { scopeField: 'site' })).toBe('site')
		expect(scopeFieldOf({ scope }, { scopeField: false })).toBe(false)
		expect(scopeFieldOf({}, { scopeField: false })).toBe(false)
	})

	it('refuses an empty, dotted or non-string field', () => {
		expect(() => scopeFieldOf({ scope }, { scopeField: '' })).toThrow(
			/collections\.pages\.scopeField must be a non-empty field name/
		)
		expect(() => scopeFieldOf({ scope }, { scopeField: 'tenant.id' })).toThrow(
			/collections\.pages\.scopeField must be a top-level field name \(no dots\)/
		)
		expect(() => scopeFieldOf({ scope }, { scopeField: true as never })).toThrow(
			/collections\.pages\.scopeField must be a non-empty field name/
		)
	})
})

describe('resolveOptions capture.paths', () => {
	it('leaves both slot paths unset so the resolver derives the proxy mount', () => {
		expect(resolveOptions({ adapters }).capture.paths).toEqual({})
	})
	it('carries per-slot path overrides through', () => {
		expect(
			resolveOptions({ adapters, capture: { paths: { global: '/pg' } } }).capture.paths
		).toEqual({ global: '/pg' })
		const scopedPaths = resolveOptions({
			adapters,
			scope,
			capture: { gate: 'all', paths: { global: '/pg', tenant: '/ph' } },
		}).capture.paths
		expect(scopedPaths).toEqual({ global: '/pg', tenant: '/ph' })
	})
})

describe('fillableSlots', () => {
	const fillable = (
		options: Partial<AnalyticsPluginOptions> & { adapters: AnalyticsPluginOptions['adapters'] }
	) => fillableSlots(options, options.scope !== undefined)

	it('fills the global slot from the single config adapter when it captures', () => {
		expect(fillable({ adapters: [native()] })).toEqual(['global'])
		expect(fillable({ adapters: [memoryAdapter()] })).toEqual([])
	})

	it('fills the global slot from capture.slots.global, else platformAdapter', () => {
		const two = [native(), memoryAdapter()]
		expect(fillable({ adapters: two })).toEqual([])
		expect(fillable({ adapters: two, capture: { slots: { global: 'native' } } })).toEqual([
			'global',
		])
		expect(fillable({ adapters: two, platformAdapter: 'native' })).toEqual(['global'])
		expect(fillable({ adapters: two, platformAdapter: 'memory' })).toEqual([])
	})

	it('fills the tenant slot on a scoped install a capture adapter or a provider could fill', () => {
		expect(fillable({ adapters: [memoryAdapter()], scope })).toEqual([])
		expect(fillable({ adapters: [memoryAdapter(), ph()], scope })).toEqual(['tenant'])
		expect(
			fillable({ adapters: [memoryAdapter()], scope, providers: { collection: true } })
		).toEqual(['tenant'])
		expect(
			fillable({ adapters: [memoryAdapter()], scope, providers: { resolve: async () => [] } })
		).toEqual(['tenant'])
	})

	it('fills nothing a slot set to false would', () => {
		expect(
			fillable({
				adapters: [native()],
				scope,
				capture: { slots: { global: false, tenant: false } },
			})
		).toEqual([])
	})
})

describe('resolveOptions capture.gate', () => {
	const gateOf = (options: Partial<AnalyticsPluginOptions> = {}) =>
		resolveOptions({ adapters: [native(), ph()], scope, ...options }).capture.gate
	const ask = (slot: CaptureGateArgs['slot'], kind: CaptureGateArgs['kind']): CaptureGateArgs => ({
		slot,
		adapterId: kind,
		kind,
	})

	it('is required whenever a slot can fill, with no default', () => {
		expect(() => resolveOptions({ adapters: [native()] })).toThrow(
			"analytics: capture.gate is required: 'all' holds every slot until your consent manager calls setGate, 'off' captures without a gate, or list the slots that wait. The plugin does not decide which tracking needs consent."
		)
		expect(() =>
			resolveOptions({ adapters: [memoryAdapter()], scope, providers: { collection: true } })
		).toThrow(/capture\.gate is required/)
	})

	it('is not required when no slot can fill, and then holds every slot', () => {
		const gate = resolveOptions({ adapters: [memoryAdapter()] }).capture.gate
		expect(gate(ask('global', 'native'))).toBe(true)
		expect(() =>
			resolveOptions({ adapters: [native()], capture: { slots: { global: false } } })
		).not.toThrow()
	})

	it("holds every slot with 'all' and none with 'off'", () => {
		const all = gateOf({ capture: { gate: 'all' } })
		const off = gateOf({ capture: { gate: 'off' } })
		for (const args of [ask('global', 'native'), ask('tenant', 'posthog')]) {
			expect(all(args)).toBe(true)
			expect(off(args)).toBe(false)
		}
	})

	it('holds exactly the slots a list names', () => {
		const gate = gateOf({ capture: { gate: ['tenant'] } })
		expect(gate(ask('tenant', 'native'))).toBe(true)
		expect(gate(ask('global', 'posthog'))).toBe(false)
	})

	it('asks a function per slot, with the adapter filling it', () => {
		const seen: CaptureGateArgs[] = []
		const gate = gateOf({
			capture: {
				gate: (args) => {
					seen.push(args)
					return args.kind !== 'native'
				},
			},
		})
		expect(gate(ask('global', 'native'))).toBe(false)
		expect(gate(ask('tenant', 'posthog'))).toBe(true)
		expect(seen).toEqual([ask('global', 'native'), ask('tenant', 'posthog')])
	})

	// A gate that forgets to return holds the slot rather than capturing without consent.
	it('holds a slot unless the function answers exactly false', () => {
		const gate = gateOf({ capture: { gate: (() => undefined) as never } })
		expect(gate(ask('global', 'native'))).toBe(true)
	})

	it('refuses any other form', () => {
		expect(() => gateOf({ capture: { gate: 'none' as never } })).toThrow(
			/capture\.gate must be 'all', 'off', a list of slots or a function, got "none"/
		)
		expect(() => gateOf({ capture: { gate: ['site'] as never } })).toThrow(
			/capture\.gate lists "site", which is not a capture slot/
		)
		expect(() => gateOf({ capture: { gate: true as never } })).toThrow(/capture\.gate must be/)
	})
})

describe('resolveOptions capture.slots', () => {
	it('throws when the global slot names an adapter the config does not carry', () => {
		expect(() => resolveOptions({ adapters, capture: { slots: { global: 'nope' } } })).toThrow(
			/capture\.slots\.global "nope" names no adapter in adapters/
		)
	})
	it('accepts an unknown tenant slot id, resolved per request against the scope registry', () => {
		const slots = resolveOptions({
			adapters,
			scope,
			capture: { slots: { tenant: 'posthog:abc123' }, gate: 'all' },
		}).capture.slots
		expect(slots.tenant).toBe('posthog:abc123')
	})
	it('carries false through as an explicit disable rather than an adapter id', () => {
		const slots = resolveOptions({ adapters, capture: { slots: { global: false, tenant: false } } })
			.capture.slots
		expect(slots).toEqual({ global: false, tenant: false })
	})
	it('rejects a slot value that is neither an adapter id nor false', () => {
		expect(() =>
			resolveOptions({ adapters, scope, capture: { slots: { tenant: true as unknown as string } } })
		).toThrow(/capture\.slots\.tenant must be an adapter id or false, got boolean/)
	})
})

describe('resolveOptions capture.autoCapture', () => {
	it('turns every auto-capture listener on by default, except scroll depth', () => {
		expect(resolveOptions({ adapters }).capture.autoCapture).toEqual({
			scrollDepth: false,
			outboundLinks: true,
			fileDownloads: true,
			goalAttribute: true,
			query: true,
			items: { impressions: true, clicks: true, pages: true },
		})
	})
	it('overrides one toggle without disturbing the rest', () => {
		const auto = resolveOptions({
			adapters,
			capture: { autoCapture: { scrollDepth: true, fileDownloads: false } },
		}).capture.autoCapture
		expect(auto).toEqual({
			scrollDepth: true,
			outboundLinks: true,
			fileDownloads: false,
			goalAttribute: true,
			query: true,
			items: { impressions: true, clicks: true, pages: true },
		})
	})
	it('turns the query string off without disturbing the rest', () => {
		const auto = resolveOptions({ adapters, capture: { autoCapture: { query: false } } }).capture
			.autoCapture
		expect(auto.query).toBe(false)
		expect(auto.outboundLinks).toBe(true)
	})
})

describe('resolveOptions capture.autoCapture items', () => {
	const items = (option: NonNullable<AnalyticsPluginOptions['capture']>['autoCapture']) =>
		resolveOptions({ adapters, capture: { autoCapture: option } }).capture.autoCapture.items

	it('turns every part of item capture off with false', () => {
		expect(items({ items: false })).toEqual({ impressions: false, clicks: false, pages: false })
	})

	it('turns one part off without disturbing the rest', () => {
		expect(items({ items: { pages: false } })).toEqual({
			impressions: true,
			clicks: true,
			pages: false,
		})
	})

	// Ingest drops every ref of a collection not bound as items, so a page has nothing to watch.
	it('hands the tracker no item capture while no collection is bound as items', () => {
		const auto = resolveOptions({ adapters }).capture.autoCapture
		expect(trackerAutoCapture(auto, false).items).toEqual({
			impressions: false,
			clicks: false,
			pages: false,
		})
		expect(trackerAutoCapture(auto, false).outboundLinks).toBe(true)
		expect(trackerAutoCapture(auto, true)).toBe(auto)
	})
})

describe('resolveOptions capture.skip', () => {
	const skip = (option: unknown) =>
		resolveOptions({ adapters, capture: { skip: option as never } }).capture.skip

	it('skips automation and previews unless told otherwise', () => {
		expect(skip(undefined)).toEqual({ automation: true, previews: true })
		expect(skip({ automation: false })).toEqual({ automation: false, previews: true })
		expect(skip({ previews: false })).toEqual({ automation: true, previews: false })
	})

	it('refuses anything but an object of booleans', () => {
		expect(() => skip(false)).toThrow(/capture\.skip must be an object/)
		expect(() => skip({ automation: 'no' })).toThrow(
			/capture\.skip\.automation must be true or false/
		)
	})

	// A misspelt key would otherwise leave the default on in silence.
	it('refuses a key it does not take, naming the ones it does', () => {
		expect(() => skip({ preview: false })).toThrow(
			'analytics: capture.skip.preview is not an option; capture.skip takes automation and previews'
		)
	})
})

describe('resolveOptions goals', () => {
	const signup: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }
	const purchase: Goal = {
		slug: 'purchase',
		name: 'Purchase',
		match: { kind: 'event', name: 'purchase' },
		value: { prop: 'total' },
		currency: 'EUR',
	}
	it('defaults to no goals', () => {
		expect(resolveOptions({ adapters }).goals).toEqual([])
	})
	it('accepts the array form', () => {
		expect(resolveOptions({ adapters, goals: [signup, purchase] }).goals).toEqual([
			signup,
			purchase,
		])
	})
	it('accepts the object form alongside the collection source', () => {
		expect(resolveOptions({ adapters, goals: { defaults: [signup] } }).goals).toEqual([signup])
	})
	it('keeps the built-in purchase goal on unless the object form turns it off', () => {
		expect(resolveOptions({ adapters }).purchaseGoal).toBe(true)
		expect(resolveOptions({ adapters, goals: [signup] }).purchaseGoal).toBe(true)
		expect(resolveOptions({ adapters, goals: { defaults: [signup] } }).purchaseGoal).toBe(true)
		expect(resolveOptions({ adapters, goals: { purchase: true } }).purchaseGoal).toBe(true)
		expect(resolveOptions({ adapters, goals: { purchase: false } }).purchaseGoal).toBe(false)
	})
	it('throws on a duplicate slug', () => {
		expect(() =>
			resolveOptions({ adapters, goals: [signup, { ...signup, name: 'Other' }] })
		).toThrow(/duplicate goal slug "signup"/i)
	})
	it('throws on a slug that is not kebab-case', () => {
		for (const slug of ['Sign Up', 'sign_up', '-signup', 'signup-']) {
			expect(() => resolveOptions({ adapters, goals: [{ ...signup, slug }] })).toThrow(
				/kebab-case/i
			)
		}
	})
	it('takes browser as true or false, and throws on anything else', () => {
		const serverOnly = { ...signup, browser: false }
		expect(resolveOptions({ adapters, goals: [serverOnly] }).goals).toEqual([serverOnly])
		expect(() =>
			resolveOptions({ adapters, goals: [{ ...signup, browser: 'no' as never }] })
		).toThrow(/goal "signup" browser must be true or false, got "no"/)
	})
	it('refuses the pre-release wire flag on a goal, naming browser', () => {
		const legacy = { ...signup, wire: false } as unknown as Goal
		expect(() => resolveOptions({ adapters, goals: [legacy] })).toThrow(
			/goal "signup" wire is not an option, use browser: false/
		)
	})
	it('throws on a fixed value that is negative or not finite', () => {
		for (const fixed of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => resolveOptions({ adapters, goals: [{ ...signup, value: { fixed } }] })).toThrow(
				/goal "signup" value.fixed/i
			)
		}
	})
	it('accepts a fixed value of zero', () => {
		expect(
			resolveOptions({ adapters, goals: [{ ...signup, value: { fixed: 0 } }] }).goals[0]?.value
		).toEqual({ fixed: 0 })
	})
	const pathGoal = (pattern: string): Goal => ({
		slug: 'docs',
		name: 'Docs',
		match: { kind: 'path', pattern },
	})
	it('accepts an address pattern at the caps', () => {
		const deepest = `/${Array(32).fill('a').join('/')}`
		expect(resolveOptions({ adapters, goals: [pathGoal(deepest)] }).goals).toHaveLength(1)
		expect(
			resolveOptions({ adapters, goals: [pathGoal('/**/a/**/b/**/c/**')] }).goals
		).toHaveLength(1)
	})
	it('refuses an address pattern over the caps, naming the goal', () => {
		expect(() =>
			resolveOptions({ adapters, goals: [pathGoal(`/${Array(33).fill('a').join('/')}`)] })
		).toThrow(/goal "docs" has more than 32 parts in its address pattern/)
		expect(() =>
			resolveOptions({ adapters, goals: [pathGoal('/**/a/**/b/**/c/**/d/**')] })
		).toThrow(/goal "docs" uses \*\* more than 4 times/)
		expect(() =>
			resolveOptions({ adapters, goals: { defaults: [pathGoal('/a**/b**/c**/d**/e**')] } })
		).toThrow(/goal "docs" uses \*\* more than 4 times/)
	})
	it('refuses a path goal whose pattern is not a string', () => {
		const broken = { slug: 'docs', name: 'Docs', match: { kind: 'path', pattern: 7 } }
		expect(() => resolveOptions({ adapters, goals: [broken as never] })).toThrow(
			/goal "docs" matches a path, so match.pattern must be a string/
		)
	})
})

describe('resolveOptions request trust', () => {
	it('leaves trustedPlatform unset by default', () => {
		expect(resolveOptions({ adapters }).trustedPlatform).toBeUndefined()
	})

	it('keeps vercel and cloudflare', () => {
		expect(resolveOptions({ adapters, trustedPlatform: 'vercel' }).trustedPlatform).toBe('vercel')
		expect(resolveOptions({ adapters, trustedPlatform: 'cloudflare' }).trustedPlatform).toBe(
			'cloudflare'
		)
	})

	it('refuses any other platform', () => {
		expect(() => resolveOptions({ adapters, trustedPlatform: 'netlify' as never })).toThrow(
			/trustedPlatform must be 'vercel' or 'cloudflare', got "netlify"/
		)
	})

	it('refuses trustedProxyHops together with trustedPlatform', () => {
		expect(() =>
			resolveOptions({ adapters, trustedProxyHops: 1, trustedPlatform: 'cloudflare' })
		).toThrow(/trustedProxyHops and trustedPlatform cannot both be set/)
		expect(() =>
			resolveOptions({ adapters, trustedProxyHops: 0, trustedPlatform: 'vercel' })
		).toThrow(/cannot both be set/)
	})

	it('normalizes capture.allowedOrigins and refuses anything but exact origins', () => {
		expect([
			...resolveOptions({
				adapters,
				capture: { allowedOrigins: ['https://Partner.example/'] },
			}).capture.allowedOrigins,
		]).toEqual(['https://partner.example'])
		expect(resolveOptions({ adapters }).capture.allowedOrigins.size).toBe(0)
		expect(() =>
			resolveOptions({ adapters, capture: { allowedOrigins: ['https://partner.example/shop'] } })
		).toThrow(/capture\.allowedOrigins entries must each be one exact origin/)
	})
})

describe('resolveOptions capture.exclusion', () => {
	it('is off by default and when false', () => {
		expect(resolveOptions({ adapters }).capture.exclusion).toBe(false)
		expect(resolveOptions({ adapters, capture: { exclusion: false } }).capture.exclusion).toBe(
			false
		)
	})

	it('turns on under analytics_exclude with true or an empty object', () => {
		for (const exclusion of [true, {}]) {
			expect(resolveOptions({ adapters, capture: { exclusion } }).capture.exclusion).toEqual({
				param: 'analytics_exclude',
			})
		}
	})

	it('turns on under the parameter an object names', () => {
		expect(
			resolveOptions({ adapters, capture: { exclusion: { param: 'staff.out_1~x' } } }).capture
				.exclusion
		).toEqual({ param: 'staff.out_1~x' })
	})

	it.each(['', 'a b', 'a&b', 'a=b', 'ä', 'x'.repeat(65)])('refuses the parameter %j', (param) => {
		expect(() => resolveOptions({ adapters, capture: { exclusion: { param } } })).toThrow(
			/capture\.exclusion\.param must be 1 to 64 letters/
		)
	})

	it.each<[string, unknown]>([
		['a string', 'analytics_exclude'],
		['a number', 1],
		['an array', [{ param: 'staff' }]],
		['null', null],
	])('refuses %s, which is neither a boolean nor an object', (_label, exclusion) => {
		expect(() => resolveOptions({ adapters, capture: { exclusion: exclusion as never } })).toThrow(
			/capture\.exclusion must be true, false or an object/
		)
	})

	it('answers a list of site addresses through a function, each trimmed to origin and path', async () => {
		const resolved = resolveOptions({
			adapters,
			capture: { exclusion: { sites: ['https://shop.example.com', 'https://example.com/de?x=1'] } },
		}).capture.exclusion
		const on = resolved === false ? undefined : resolved
		expect(on?.param).toBe('analytics_exclude')
		expect(await on?.sites?.({ req: {} as never, scope: null })).toEqual([
			'https://shop.example.com/',
			'https://example.com/de',
		])
	})

	it('keeps a sites function as it is, for the endpoint to check per request', () => {
		const sites = () => ['https://shop.example.com']
		const resolved = resolveOptions({ adapters, capture: { exclusion: { sites } } }).capture
			.exclusion
		expect(resolved === false ? undefined : resolved.sites).toBe(sites)
	})

	it.each<[string, unknown]>([
		['an address without a scheme', ['shop.example.com']],
		['a non-web scheme', ['ftp://files.example.com']],
		['a string', 'https://shop.example.com'],
		['a number in the list', [7]],
	])('refuses sites given as %s', (_label, sites) => {
		expect(() =>
			resolveOptions({ adapters, capture: { exclusion: { sites: sites as never } } })
		).toThrow(/capture\.exclusion\.sites must be a function or a list of http\(s\) addresses/)
	})
})

describe('untrustedAddressNotice', () => {
	const nativeOnly = (extra: Partial<AnalyticsPluginOptions> = {}) =>
		resolveOptions({ adapters: [native()], capture: { gate: 'off' }, ...extra })

	it('speaks up in production when neither trust option is set and native captures', () => {
		const notice = untrustedAddressNotice(nativeOnly(), true)
		expect(notice).toMatch(/visitor IP addresses and countries can be spoofed/)
		expect(notice).toMatch(/trustedProxyHops/)
		expect(notice).toMatch(/trustedPlatform/)
	})

	it('speaks up for a proxied vendor slot, and for runtime providers', () => {
		expect(
			untrustedAddressNotice(resolveOptions({ adapters: [ph()], capture: { gate: 'off' } }), true)
		).not.toBeNull()
		expect(
			untrustedAddressNotice(resolveOptions({ adapters, providers: { collection: true } }), true)
		).not.toBeNull()
	})

	it('stays quiet outside production, with either trust option, and with nothing captured', () => {
		expect(untrustedAddressNotice(nativeOnly(), false)).toBeNull()
		expect(untrustedAddressNotice(nativeOnly({ trustedProxyHops: 1 }), true)).toBeNull()
		expect(untrustedAddressNotice(nativeOnly({ trustedPlatform: 'vercel' }), true)).toBeNull()
		expect(untrustedAddressNotice(resolveOptions({ adapters }), true)).toBeNull()
	})
})

describe('resolveOptions goals collection', () => {
	const collectionOf = (goals: AnalyticsPluginOptions['goals'], scoped = false) =>
		resolveOptions({ adapters, goals, ...(scoped ? { scope } : {}) }).goalsCollection
	const off = { enabled: false, slug: 'analytics-goals', scopeField: 'scope' }

	it('is off unless asked for, in every goals form', () => {
		expect(collectionOf(undefined)).toEqual(off)
		expect(collectionOf([])).toEqual(off)
		expect(collectionOf({ defaults: [] })).toEqual(off)
		expect(collectionOf({ collection: false })).toEqual(off)
	})

	it('defaults the slug and the scope field for true and for an object', () => {
		expect(collectionOf({ collection: true })).toEqual({ ...off, enabled: true })
		expect(collectionOf({ collection: {} })).toEqual({ ...off, enabled: true })
	})

	it('carries the slug, scope field, access and overrides through', () => {
		const overrides = (c: CollectionConfig) => c
		const access = { read: () => true }
		expect(
			collectionOf(
				{ collection: { slug: 'conversions', scopeField: 'tenant', access, overrides } },
				true
			)
		).toEqual({ enabled: true, slug: 'conversions', scopeField: 'tenant', access, overrides })
	})

	it('stores the slug trimmed', () => {
		expect(collectionOf({ collection: { slug: '  conversions  ' } }).slug).toBe('conversions')
	})

	it('throws on an empty slug or an unusable scope field', () => {
		expect(() => collectionOf({ collection: { slug: '  ' } })).toThrow(/non-empty collection slug/i)
		expect(() => collectionOf({ collection: { scopeField: '' } }, true)).toThrow(
			/non-empty field name/i
		)
		expect(() => collectionOf({ collection: { scopeField: 'tenant.id' } }, true)).toThrow(
			/no dots/i
		)
	})
})

describe('resolveOptions view', () => {
	it('fills the defaults when the option is absent', () => {
		expect(resolveOptions({ adapters }).view).toEqual({
			path: '/analytics',
			defaultRange: 'last30days',
			defaultMetric: 'pageviews',
		})
	})

	it('keeps false so nothing is registered', () => {
		expect(resolveOptions({ adapters, view: false }).view).toBe(false)
	})

	it('carries path, range, metric and navLabel through', () => {
		expect(
			resolveOptions({
				adapters,
				view: {
					path: '/insights',
					defaultRange: 'last7days',
					defaultMetric: 'visitors',
					navLabel: 'Traffic',
				},
			}).view
		).toEqual({
			path: '/insights',
			defaultRange: 'last7days',
			defaultMetric: 'visitors',
			navLabel: 'Traffic',
		})
	})

	it('rejects a path that is not rooted', () => {
		expect(() => resolveOptions({ adapters, view: { path: 'insights' as `/${string}` } })).toThrow(
			/view\.path/i
		)
	})

	it('rejects an unknown timeframe preset or metric', () => {
		expect(() =>
			resolveOptions({ adapters, view: { defaultRange: '30d' as 'last30days' } })
		).toThrow(/view\.defaultRange/i)
		expect(() =>
			resolveOptions({ adapters, view: { defaultMetric: 'clicks' as 'pageviews' } })
		).toThrow(/view\.defaultMetric/i)
	})
})

describe('resolveOptions countryFlags', () => {
	it('is on by default, with or without the view', () => {
		expect(resolveOptions({ adapters }).countryFlags).toBe(true)
		expect(resolveOptions({ adapters, view: false }).countryFlags).toBe(true)
	})

	it('keeps false, so nothing draws a flag', () => {
		expect(resolveOptions({ adapters, countryFlags: false }).countryFlags).toBe(false)
	})

	it('rejects a value that is neither a boolean nor a component', () => {
		expect(() => resolveOptions({ adapters, countryFlags: 'emoji' as never })).toThrow(
			/countryFlags must be a boolean or \{ Component \}/
		)
	})

	it("takes the host's own flag component, in either form Payload takes one", () => {
		expect(
			resolveOptions({ adapters, countryFlags: { Component: '/components/Flag#Flag' } })
				.countryFlags
		).toEqual({ Component: '/components/Flag#Flag' })
		expect(
			resolveOptions({
				adapters,
				countryFlags: { Component: { path: '/components/Flag', exportName: 'Flag' } },
			}).countryFlags
		).toEqual({ Component: { path: '/components/Flag', exportName: 'Flag' } })
	})

	it('refuses a flag component that is no component path, and a key beside it that is no option', () => {
		expect(() => resolveOptions({ adapters, countryFlags: { Component: '' } })).toThrow(
			/countryFlags\.Component must be a component path/
		)
		expect(() =>
			resolveOptions({ adapters, countryFlags: { Component: { path: 3 } } as never })
		).toThrow(/countryFlags\.Component must be a component path/)
		expect(() =>
			resolveOptions({ adapters, countryFlags: { Component: 'x#Y', size: 2 } as never })
		).toThrow(/countryFlags\.size is not an option/)
	})
})

describe('resolveOptions view.Component', () => {
	it('keeps the component a host puts in place of the view body', () => {
		const view = resolveOptions({ adapters, view: { Component: '/views/Analytics#View' } }).view
		expect(view === false ? undefined : view.Component).toBe('/views/Analytics#View')
	})

	it('refuses a component that is not a path or a component object', () => {
		expect(() => resolveOptions({ adapters, view: { Component: 42 as never } })).toThrow(
			/view\.Component must be a component path/
		)
	})
})

describe('resolveOptions widgets.overrides', () => {
	it('keeps an override per built-in widget, and none by default', () => {
		const fields = () => []
		const widgets = resolveOptions({
			adapters,
			widgets: {
				overrides: {
					'analytics-metric': { Component: '/w/Metric#Metric', label: 'Number', fields },
				},
			},
		}).widgets
		expect(widgets.overrides['analytics-metric']).toEqual({
			Component: '/w/Metric#Metric',
			label: 'Number',
			fields,
		})
		expect(resolveOptions({ adapters }).widgets.overrides).toEqual({})
	})

	it('refuses a slug that names no built-in widget, pointing at widgets.register', () => {
		expect(() =>
			resolveOptions({
				adapters,
				widgets: { overrides: { 'analytics-visitors': { label: 'x' } } as never },
			})
		).toThrow(/names "analytics-visitors", which is no built-in widget.*widgets\.register/)
	})

	it('refuses an override key, a label or a fields option it cannot use', () => {
		expect(() =>
			resolveOptions({
				adapters,
				widgets: { overrides: { 'analytics-trend': { width: 'full' } as never } },
			})
		).toThrow(/widgets\.overrides\.analytics-trend\.width is not an option/)
		expect(() =>
			resolveOptions({
				adapters,
				widgets: { overrides: { 'analytics-trend': { label: 7 as never } } },
			})
		).toThrow(/analytics-trend\.label must be a string/)
		expect(() =>
			resolveOptions({
				adapters,
				widgets: { overrides: { 'analytics-trend': { fields: [] as never } } },
			})
		).toThrow(/analytics-trend\.fields must be a function/)
		expect(() =>
			resolveOptions({
				adapters,
				widgets: { overrides: { 'analytics-trend': { Component: { path: '' } } } },
			})
		).toThrow(/analytics-trend\.Component must be a component path/)
	})
})

describe('resolveOptions routes', () => {
	it('mounts under /_x unless the host moves it', () => {
		expect(resolveOptions({ adapters }).routes).toEqual({ base: '/_x' })
		expect(resolveOptions({ adapters, routes: {} }).routes).toEqual({ base: '/_x' })
		expect(resolveOptions({ adapters, routes: { base: '/stats' } }).routes).toEqual({
			base: '/stats',
		})
	})

	it('refuses a base Payload cannot route, and a routes value that is not an object', () => {
		expect(() => resolveOptions({ adapters, routes: { base: '/stats/' } })).toThrow(
			/routes\.base must be a path of plain segments/
		)
		expect(() => resolveOptions({ adapters, routes: { base: '/globals/x' } })).toThrow(
			/routes\.base "\/globals\/x" starts with "\/globals"/
		)
		expect(() => resolveOptions({ adapters, routes: '/stats' as never })).toThrow(
			/routes must be an object/
		)
	})
})

describe('resolveOptions jobs', () => {
	it('schedules every task on the default queue at its own cadence, none with false', () => {
		expect(resolveOptions({ adapters }).jobs).toEqual(DEFAULT_JOBS)
		expect(resolveOptions({ adapters, jobs: false }).jobs).toBe(false)
		expect(
			resolveOptions({
				adapters,
				jobs: { queue: 'analytics', tasks: { maintain: { cron: false } } },
			}).jobs
		).toMatchObject({
			maintain: { queue: 'analytics', cron: null, intervalMs: 900_000 },
			sync: { queue: 'analytics', cron: '0 */6 * * *' },
			warm: { queue: 'analytics', cron: '*/30 * * * *' },
		})
	})

	it('refuses jobs: false beside sync or warming, whose tasks alone do their work', () => {
		expect(() => resolveOptions({ adapters, jobs: false, sync: true })).toThrow(
			/jobs: false registers no task, but this install turns on sync, which only the analytics-sync task fills\. Turn it off/
		)
		expect(() =>
			resolveOptions({ adapters, jobs: false, sync: true, cache: { warm: true } })
		).toThrow(
			/turns on sync, .* and cache\.warm, which only the analytics-warm task runs\. Turn them off/
		)
	})

	it('refuses an entry for a task the install does not register', () => {
		expect(() =>
			resolveOptions({ adapters, jobs: { tasks: { sync: { queue: 'analytics' } } } })
		).toThrow(
			/jobs\.tasks\.sync schedules analytics-sync, which is registered only while sync is on/
		)
		expect(() => resolveOptions({ adapters, jobs: { tasks: { warm: { cron: false } } } })).toThrow(
			/jobs\.tasks\.warm schedules analytics-warm, which is registered only while cache\.warm is on/
		)
		expect(() =>
			resolveOptions({
				adapters,
				sync: true,
				cache: { warm: true },
				jobs: { tasks: { sync: { cron: '0 3 * * *' }, warm: { queue: 'warm' } } },
			})
		).not.toThrow()
	})

	it('fails the boot on a jobs option it cannot schedule', () => {
		expect(() => resolveOptions({ adapters, jobs: true as never })).toThrow(/jobs must be false/)
		expect(() =>
			resolveOptions({ adapters, jobs: { tasks: { maintain: { cron: 'often' } } } })
		).toThrow(/jobs\.tasks\.maintain\.cron must be a cron pattern/)
	})
})

describe('resolveOptions sdks', () => {
	class BetaAnalyticsDataClient {
		runReport = async () => [{}]
	}
	const open = async () => ({})

	it('is empty unless set, and carries what was passed in', () => {
		expect(resolveOptions({ adapters }).sdks).toEqual({})
		const sdks = { ga4: { BetaAnalyticsDataClient }, maxmind: { open } } as unknown as NonNullable<
			AnalyticsPluginOptions['sdks']
		>
		expect(resolveOptions({ adapters, sdks }).sdks).toEqual(sdks)
	})

	it.each([
		['a string', 'yes', /sdks must be an object/],
		['a ga4 without the client', { ga4: {} }, /sdks\.ga4 must be \{ BetaAnalyticsDataClient \}/],
		['a maxmind without open', { maxmind: { open: 'x' } }, /sdks\.maxmind must be \{ open \}/],
	])('refuses %s at boot', (_label, sdks, message) => {
		expect(() => resolveOptions({ adapters, sdks: sdks as never })).toThrow(message)
	})
})
