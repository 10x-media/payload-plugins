import { withEncryptedQueryRewrite } from '@10x-media/fields/encrypted'
import type { CollectionConfig, Config, Field, Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { isAdminUser } from './access/adminUser'
import { posthog } from './adapters/posthog/posthog'
import type { AnalyticsPluginOptions } from './core/options'
import type { Goal } from './goals/types'
import { analytics } from './index'
import { native } from './native/nativeAdapter'
import { ANALYTICS_CONFIG_KEY, DEFAULT_ROUTE_BASE, routePaths } from './plugin/routes'
import {
	getRuntime,
	resolveCaptureScopeFor,
	resolveScopeFor,
	runtimeFactoryOf,
} from './plugin/runtime'
import { PROVIDERS_SLUG } from './providers/collection'
import { memoryAdapter } from './testing/memoryAdapter'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

const FLAGS_PATTERN = routePaths(DEFAULT_ROUTE_BASE).flagsPattern

const endpointPaths = (config: Config): string[] =>
	(config.endpoints ?? []).map((endpoint) => endpoint.path)

describe('analytics factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof analytics({ adapters: [memoryAdapter()] })).toBe('function')
	})
	it('keeps only its schema when disabled: no endpoint, view, hook or translation', async () => {
		const out = (await analytics({ disabled: true, adapters: [] })(fakeConfig())) as Config
		expect((out.collections ?? []).map((collection) => collection.slug)).toEqual([
			'analytics-cache',
		])
		expect(out.endpoints ?? []).toEqual([])
		expect(out.onInit).toBeUndefined()
		expect(out.i18n).toBeUndefined()
		expect(out.custom?.[ANALYTICS_CONFIG_KEY]).toBeUndefined()
		expect(out.admin?.components).toBeUndefined()
		expect(out.jobs).toBeUndefined()
	})

	it('keeps every task slug when disabled, each doing nothing and never scheduled', async () => {
		const out = (await analytics({
			disabled: true,
			adapters: [native(), memoryAdapter()],
			capture: { gate: 'off' },
			sync: true,
			cache: { warm: true },
		})(fakeConfig())) as Config
		const tasks = out.jobs?.tasks ?? []
		expect(tasks.map((task) => task.slug)).toEqual([
			'analytics-maintain',
			'analytics-warm',
			'analytics-sync',
		])
		for (const task of tasks) {
			const handler = task.handler
			if (typeof handler !== 'function') {
				throw new Error(`${task.slug} has no handler function`)
			}
			expect(await handler({} as never)).toEqual({ output: {} })
			const hook = task.schedule?.[0]?.hooks?.beforeSchedule
			expect(await hook?.({} as never)).toEqual({ shouldSchedule: false })
		}
		expect(out.endpoints ?? []).toEqual([])
		expect((out.collections ?? []).map((collection) => collection.slug)).toEqual([
			'analytics-hits',
			'analytics-aggregates',
			'analytics-state',
			'analytics-daily',
			'analytics-cache',
		])
		expect(out.jobs?.access).toEqual({ run: isAdminUser, queue: isAdminUser, cancel: isAdminUser })
	})
	it('restricts the job controls the host left unset once a task turns jobs on, and no others', async () => {
		const run = () => true
		const out = (await analytics({ adapters: [native()], capture: { gate: 'off' } })({
			...fakeConfig(),
			jobs: { access: { run } },
		})) as Config
		expect(out.jobs?.access).toEqual({ run, queue: isAdminUser, cancel: isAdminUser })
		expect(typeof out.jobs?.jobsCollectionOverrides).toBe('function')
		const vendorOnly = (await analytics({ adapters: [memoryAdapter()] })(fakeConfig())) as Config
		expect(vendorOnly.jobs).toBeUndefined()
	})
	it('refuses a renamed option even while disabled', async () => {
		const options = { disabled: true, adapters: [], scopeResolver: () => null }
		await expect(analytics(options)(fakeConfig())).rejects.toThrow(/scopeResolver.*scope\.resolve/)
	})
	it('registers translations when enabled', async () => {
		const out = (await analytics({ adapters: [memoryAdapter()] })(fakeConfig())) as Config
		expect(out.i18n?.translations).toBeDefined()
	})
	it('registers German translations out of the box', async () => {
		const out = (await analytics({ adapters: [memoryAdapter()] })(fakeConfig())) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.analytics?.metricPageviews).toBe('Seitenaufrufe')
		expect(i18n.de?.analytics?.comparisonVsPrevious).toBe('gegenüber dem Vorzeitraum')
		expect(i18n.de?.analytics?.comparisonIncrease).toBe('Gestiegen')
		expect(i18n.de?.analytics?.comparisonDecrease).toBe('Gesunken')
		expect(i18n.de?.analytics?.comparisonNoChange).toBe('Keine Änderung')
	})

	it('applies the translations option and a project override wins over the built-in', async () => {
		const out = (await analytics({
			adapters: [memoryAdapter()],
			translations: { de: { [keys.pluginName]: 'Analytik' } },
		})(fakeConfig())) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.analytics?.pluginName).toBe('Analytik')
		expect(i18n.en?.analytics?.pluginName).toBe('Analytics')
		// Built-in German keys not overridden remain intact.
		expect(i18n.de?.analytics?.metricPageviews).toBe('Seitenaufrufe')
	})
	it('mounts the flag route by default and drops it when countryFlags is off', async () => {
		const paths = async (options: Partial<AnalyticsPluginOptions> = {}): Promise<string[]> =>
			endpointPaths(
				(await analytics({ adapters: [memoryAdapter()], ...options })(fakeConfig())) as Config
			)
		expect(await paths()).toContain(FLAGS_PATTERN)
		// A `view: false` install still renders widgets, which still draw flags.
		expect(await paths({ view: false })).toContain(FLAGS_PATTERN)
		expect(await paths({ countryFlags: false })).not.toContain(FLAGS_PATTERN)
		expect(await paths({ view: false, countryFlags: false })).not.toContain(FLAGS_PATTERN)
	})

	it('registers every task the install turns on, each on its queue, and none with jobs: false', async () => {
		const configOf = async (options: Partial<AnalyticsPluginOptions>): Promise<Config> =>
			(await analytics({
				adapters: [native(), memoryAdapter()],
				capture: { gate: 'off' },
				...options,
			})(fakeConfig())) as Config
		const slugsOf = (config: Config): string[] =>
			(config.jobs?.tasks ?? []).map((task) => task.slug)
		const all = await configOf({
			sync: true,
			cache: { warm: true },
			jobs: { queue: 'analytics', tasks: { sync: { cron: false } } },
		})
		expect(slugsOf(all)).toEqual(['analytics-maintain', 'analytics-warm', 'analytics-sync'])
		expect(
			(all.jobs?.tasks ?? []).map((task) => [
				task.slug,
				task.schedule?.[0]?.queue,
				task.schedule?.[0]?.cron,
			])
		).toEqual([
			['analytics-maintain', 'analytics', '*/15 * * * *'],
			['analytics-warm', 'analytics', '*/30 * * * *'],
			['analytics-sync', undefined, undefined],
		])
		// Payload refuses a concurrency key unless the host turned concurrency control on.
		expect((all.jobs?.tasks ?? []).some((task) => task.concurrency)).toBe(false)
		expect(slugsOf(await configOf({ jobs: false }))).toEqual([])
	})

	it('keys each task’s runs for Payload’s concurrency control where the host turned it on', async () => {
		const out = (await analytics({
			adapters: [native(), memoryAdapter()],
			capture: { gate: 'off' },
			sync: true,
			cache: { warm: true },
		})({ ...fakeConfig(), jobs: { enableConcurrencyControl: true } })) as Config
		const keys = (out.jobs?.tasks ?? []).map((task) => {
			const concurrency = task.concurrency
			return typeof concurrency === 'object'
				? [
						concurrency.key({ input: {}, queue: 'default' }),
						concurrency.exclusive,
						concurrency.supersedes,
					]
				: concurrency
		})
		expect(keys).toEqual([
			['analytics:maintain', true, false],
			['analytics:warm', true, false],
			['analytics:sync', true, false],
		])
	})

	it('registers analytics-state for the sync and warm leases on an install without native()', async () => {
		const slugsOf = async (options: Partial<AnalyticsPluginOptions>): Promise<string[]> =>
			(
				((await analytics({ adapters: [memoryAdapter()], ...options })(fakeConfig())) as Config)
					.collections ?? []
			).map((collection) => collection.slug)
		expect(await slugsOf({ sync: true })).toContain('analytics-state')
		expect(await slugsOf({ cache: { warm: true } })).toContain('analytics-state')
		expect(await slugsOf({})).not.toContain('analytics-state')
	})

	it('refuses a maintain entry on an install whose adapters register no maintenance', async () => {
		await expect(
			analytics({
				adapters: [memoryAdapter()],
				jobs: { tasks: { maintain: { cron: '0 * * * *' } } },
			})(fakeConfig())
		).rejects.toThrow(
			/jobs\.tasks\.maintain schedules analytics-maintain, which only native\(\) registers/
		)
	})

	it('throws when no adapters are supplied', async () => {
		await expect(analytics({ adapters: [] })(fakeConfig())).rejects.toThrow(/at least one adapter/i)
	})
	it('invokes an adapter register hook against the config', async () => {
		const calls: string[] = []
		const reg = {
			...memoryAdapter(),
			register: (cfg: Config) => {
				calls.push('registered')
				cfg.custom = { ...(cfg.custom ?? {}), analyticsRegistered: true }
			},
		}
		const out = (await analytics({ adapters: [reg] })(fakeConfig())) as Config
		expect(calls).toEqual(['registered'])
		expect(out.custom?.analyticsRegistered).toBe(true)
	})

	it('wraps the providers collection with the encrypted response strip on its own', async () => {
		const out = (await analytics({
			adapters: [memoryAdapter()],
			providers: { collection: true },
		})(fakeConfig())) as Config
		const providers = out.collections?.find((c) => c.slug === PROVIDERS_SLUG)
		expect(providers?.hooks?.afterRead?.length).toBeGreaterThan(0)
	})

	it('stays sound when wrapped a second time, as a consumer fields() plugin would', async () => {
		const out = (await analytics({
			adapters: [memoryAdapter()],
			providers: { collection: true },
		})(fakeConfig())) as Config
		const providers = out.collections?.find((c) => c.slug === PROVIDERS_SLUG)
		if (!providers) throw new Error('providers collection missing')

		// A consumer's own fields plugin wrapping the collection a second time: it must not throw,
		// and the strip stays a no-op past the first pass.
		const rewrapped = withEncryptedQueryRewrite(providers)
		expect(rewrapped.hooks?.afterRead).toHaveLength(2)

		let doc: Record<string, unknown> = {
			plausible: { apiKey: 'pfe1.k0.fake.ciphertext', siteId: 'example.com' },
		}
		for (const hook of rewrapped.hooks?.afterRead ?? []) {
			doc = (await hook({ context: {}, doc } as never)) as Record<string, unknown>
		}
		expect((doc.plausible as Record<string, unknown>).apiKey).toBeUndefined()
		expect((doc.plausible as Record<string, unknown>).siteId).toBe('example.com')
	})
})

describe('analytics boot', () => {
	const pages = (fields: Field[] = []): CollectionConfig => ({
		slug: 'pages',
		fields: [{ name: 'slug', type: 'text' }, ...fields],
	})

	/** Runs the plugin and its onInit against a Payload just large enough for both. */
	const boot = async (
		options: AnalyticsPluginOptions,
		collections: CollectionConfig[] = [],
		host: {
			/** What a later plugin adds once this one has run. */
			later?: (config: Config) => Config
			/** The instance's database adapter, as far as the plugin reads it. */
			db?: Record<string, unknown>
		} = {}
	) => {
		const { later = (config: Config) => config, db = { name: 'postgres' } } = host
		const warn = vi.fn()
		const config = later((await analytics(options)({ collections } as unknown as Config)) as Config)
		const payload = {
			config: { ...config, collections: config.collections ?? [], globals: config.globals ?? [] },
			logger: { warn, info: vi.fn(), error: vi.fn() },
			kv: {},
			db,
		} as unknown as Payload
		await config.onInit?.(payload)
		return { payload, warn }
	}

	/** An instance built without onInit, as a jobs worker boots: its runtime builds on first use. */
	const workerWith = async (shape: (config: Config) => Config): Promise<Payload> => {
		const config = shape(
			(await analytics({ adapters: [memoryAdapter()] })({
				collections: [],
			} as unknown as Config)) as Config
		)
		return {
			config: { ...config, collections: config.collections ?? [] },
			logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
			kv: {},
			db: { name: 'postgres' },
		} as unknown as Payload
	}

	const valued: Goal = { slug: 'demo', name: 'Demo', match: { kind: 'goal' }, value: { fixed: 5 } }

	// Otherwise every endpoint answers 503 with nothing to say why.
	it('refuses to boot when a later plugin replaced config.custom, naming the fix', async () => {
		await expect(
			boot({ adapters: [memoryAdapter()] }, [], {
				later: (config) => ({ ...config, custom: { other: true } }),
			})
		).rejects.toThrow(/replaced config\.custom instead of spreading it/)
		await expect(
			boot({ adapters: [memoryAdapter()] }, [], {
				later: (config) => ({ ...config, custom: { ...config.custom, other: true } }),
			})
		).resolves.toBeDefined()
	})

	it('warns once when money is off and a config goal carries a value', async () => {
		const { warn } = await boot({ adapters: [memoryAdapter()], goals: [valued] })
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/revenue is off.*"demo"/))
	})

	// `next build` boots Payload in every page-data worker with NODE_ENV production; the server
	// that later serves the build says all of this once.
	it('says nothing at boot while next build collects page data', async () => {
		// A proxied vendor slot reads visitor addresses, warming registers a task, a goal is valued.
		const loud: AnalyticsPluginOptions = {
			adapters: [posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' })],
			capture: { gate: 'off' },
			cache: { warm: true },
			goals: [valued],
		}
		vi.stubEnv('NODE_ENV', 'production')
		vi.stubEnv('NEXT_PHASE', 'phase-production-build')
		try {
			const { warn } = await boot(loud)
			expect(warn).not.toHaveBeenCalled()
		} finally {
			vi.unstubAllEnvs()
		}
		vi.stubEnv('NODE_ENV', 'production')
		try {
			const { warn } = await boot(loud)
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/revenue is off/))
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/can be spoofed/))
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/job controls/))
		} finally {
			vi.unstubAllEnvs()
		}
	})

	// libsql opens every connection after a transaction without the busy timeout Payload set.
	it('warns once at boot when the SQLite adapter sets transactionOptions', async () => {
		const client = { protocol: 'file', execute: vi.fn(), batch: vi.fn(), transaction: vi.fn() }
		const sqlite = (extra: Record<string, unknown>) =>
			boot({ adapters: [memoryAdapter()] }, [], { db: { name: 'sqlite', client, ...extra } })
		const { warn } = await sqlite({ transactionOptions: {} })
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/sets transactionOptions/))
		expect((await sqlite({})).warn).not.toHaveBeenCalled()
	})

	it('says nothing about money when revenue is on', async () => {
		const { warn } = await boot({ adapters: [memoryAdapter()], goals: [valued], revenue: true })
		expect(warn).not.toHaveBeenCalled()
	})

	const scope = { resolve: () => 'alpha', member: () => true }
	const bound = { pages: { pathField: 'slug' } }

	// Pages shared by every tenant carry no tenant field, so the default has to be turned off.
	it("fails the boot when a scoped binding's default tenant field does not exist, naming the default", async () => {
		const boots = boot({ adapters: [memoryAdapter()], scope, collections: bound }, [pages()])
		await expect(boots).rejects.toThrow(
			/collections\.pages\.scopeField "tenant" does not exist on pages; "tenant" is the default on a scoped install when scopeField is not set, so .*false/
		)
	})

	it('fails the boot for a named scope field the collection does not have', async () => {
		const collections = { pages: { pathField: 'slug', scopeField: 'site' } }
		const boots = boot({ adapters: [memoryAdapter()], scope, collections }, [pages()])
		await expect(boots).rejects.toThrow(/collections\.pages\.scopeField "site" does not exist/)
		await expect(boots).rejects.not.toThrow(/is the default/)
	})

	it('boots once the field exists, or the binding reads the request scope', async () => {
		const tenant: Field = { name: 'tenant', type: 'text' }
		await expect(
			boot({ adapters: [memoryAdapter()], scope, collections: bound }, [pages([tenant])])
		).resolves.toBeDefined()
		const off = { pages: { pathField: 'slug', scopeField: false as const } }
		await expect(
			boot({ adapters: [memoryAdapter()], scope, collections: off }, [pages()])
		).resolves.toBeDefined()
	})

	it("refuses a scope resolver answering '*' on every read path", async () => {
		const { payload } = await boot({
			adapters: [memoryAdapter()],
			scope: { resolve: () => '*', member: () => true },
		})
		const runtime = getRuntime(payload)
		await expect(runtime?.resolveScope?.({} as PayloadRequest, 'admin')).rejects.toThrow(
			/scope\.resolve returned "\*"/
		)
		await expect(runtime?.resolveScope?.({} as PayloadRequest, 'capture')).rejects.toThrow(
			/scope\.resolve returned "\*"/
		)
	})

	it('tells the resolver which call site asks, and strips identity from a capture', async () => {
		const seen: Array<{ callSite: string; user: unknown; cookie: string | null }> = []
		const { payload } = await boot({
			adapters: [memoryAdapter()],
			scope: {
				resolve: ({ req, callSite }) => {
					seen.push({ callSite, user: req.user, cookie: req.headers.get('cookie') })
					return null
				},
				member: () => true,
			},
		})
		const runtime = getRuntime(payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		const editor = {
			payload,
			user: { id: 1, collection: 'users' },
			headers: new Headers({ cookie: 'payload-token=abc' }),
		} as unknown as PayloadRequest
		await resolveScopeFor(runtime, editor)
		await resolveCaptureScopeFor(runtime, editor)
		expect(seen).toEqual([
			{ callSite: 'admin', user: editor.user, cookie: 'payload-token=abc' },
			{ callSite: 'capture', user: null, cookie: null },
		])
	})

	it('builds the runtime at init, the one getRuntime then keeps serving', async () => {
		const { payload } = await boot({ adapters: [memoryAdapter()] })
		const runtime = getRuntime(payload)
		expect(runtime?.registry.default().id).toBe('memory')
		expect(getRuntime(payload)).toBe(runtime)
	})

	it('refuses, at init, a collection a later plugin adds under the base', async () => {
		const shadow = (config: Config): Config => ({
			...config,
			collections: [...(config.collections ?? []), { slug: '_x', fields: [] }],
		})
		await expect(boot({ adapters: [memoryAdapter()] }, [], { later: shadow })).rejects.toThrow(
			/"_x" collection's slug is the first segment of routes\.base "\/_x"/
		)
		await expect(
			boot({ adapters: [memoryAdapter()], routes: { base: '/stats' } }, [], { later: shadow })
		).resolves.toBeDefined()
	})

	it('refuses, when a runtime is built, an endpoint a later plugin puts in front of its routes', async () => {
		const handler = async () => Response.json({})
		const inFront = (config: Config): Config => ({
			...config,
			endpoints: [{ method: 'get', path: '/:anything*', handler }, ...(config.endpoints ?? [])],
		})
		await expect(boot({ adapters: [memoryAdapter()] }, [], { later: inFront })).rejects.toThrow(
			/root endpoint "GET \/:anything\*" is registered before the plugin's/
		)
		const worker = await workerWith(inFront)
		expect(() => getRuntime(worker)).toThrow(/routes\.base/)
	})

	it('refuses, at config time, a host endpoint registered before it over one of its routes', async () => {
		const handler = async () => Response.json({})
		const host = {
			collections: [],
			endpoints: [{ method: 'post', path: '/_x/e', handler }],
		} as unknown as Config
		await expect(
			analytics({ adapters: [native()], capture: { gate: 'off' } })(host)
		).rejects.toThrow(/root endpoint "POST \/_x\/e" is registered before the plugin's "\/_x\/e"/)
	})
})

describe('analytics routes', () => {
	const pages: CollectionConfig = { slug: 'pages', fields: [{ name: 'slug', type: 'text' }] }

	const run = async (options: Partial<AnalyticsPluginOptions> = {}): Promise<Config> =>
		(await analytics({
			adapters: [native()],
			capture: { gate: 'off' },
			collections: { pages: { pathField: 'slug' } },
			...options,
		})({ collections: [pages] } as unknown as Config)) as Config

	it('mounts every endpoint under the default base', async () => {
		const routes = routePaths(DEFAULT_ROUTE_BASE)
		expect(new Set(endpointPaths(await run()))).toEqual(
			new Set([
				routes.ingest,
				routes.live,
				routes.document,
				routes.sources,
				routes.goals,
				routes.query,
				routes.refresh,
				routes.flagsPattern,
				routes.proxyPattern,
				routes.config,
			])
		)
	})

	it('moves every endpoint, native ingest included, with routes.base', async () => {
		const paths = endpointPaths(await run({ routes: { base: '/stats/v1' } }))
		expect(paths.length).toBeGreaterThan(0)
		for (const path of paths) {
			expect(path.startsWith('/stats/v1/'), path).toBe(true)
		}
		expect(paths).toContain('/stats/v1/e')
	})

	it("keeps native's own ingestPath over the base", async () => {
		const paths = endpointPaths(await run({ adapters: [native({ ingestPath: '/collect' })] }))
		expect(paths).toContain('/collect')
		expect(paths).not.toContain('/_x/e')
	})

	it('leaves the base in admin.custom for the client and the factory in custom', async () => {
		const config = await run({ routes: { base: '/stats' } })
		expect(config.admin?.custom?.[ANALYTICS_CONFIG_KEY]).toEqual({ routes: { base: '/stats' } })
		expect(runtimeFactoryOf(config)).toBeDefined()
	})

	it('refuses a host collection named after the first segment of the base', async () => {
		const host = { collections: [{ slug: 'stats', fields: [] }] } as unknown as Config
		await expect(
			analytics({ adapters: [memoryAdapter()], routes: { base: '/stats/v1' } })(host)
		).rejects.toThrow(
			/"stats" collection's slug is the first segment of routes\.base "\/stats\/v1"/
		)
		await expect(
			analytics({ adapters: [memoryAdapter()], routes: { base: '/insights' } })(host)
		).resolves.toBeDefined()
	})

	it("refuses the plugin's own collection under the base too", async () => {
		await expect(
			analytics({
				adapters: [memoryAdapter()],
				routes: { base: '/goals' },
				goals: { collection: { slug: 'goals' } },
			})(fakeConfig())
		).rejects.toThrow(/"goals" collection's slug/)
	})
})

describe('analytics collections', () => {
	const slugsOf = (config: Config): string[] =>
		(config.collections ?? []).map((collection) => collection.slug)

	const run = (options: AnalyticsPluginOptions, config = fakeConfig()) =>
		analytics({ capture: { gate: 'off' }, ...options })(config) as Promise<Config>

	const without =
		(name: string) =>
		(collection: CollectionConfig): CollectionConfig => ({
			...collection,
			fields: collection.fields.filter((field: Field) => !('name' in field) || field.name !== name),
		})

	it('registers every collection under the slug its option names, and nothing under a default', async () => {
		const config = await run({
			adapters: [
				native({
					collections: {
						hits: { slug: 'site-hits' },
						aggregates: { slug: 'site-totals' },
						state: { slug: 'site-state' },
					},
				}),
				memoryAdapter(),
			],
			providers: { collection: { slug: 'site-providers' } },
			goals: { collection: { slug: 'site-goals' } },
			sync: { collection: { slug: 'site-daily' } },
			cache: { collection: { slug: 'site-cache' }, warm: true },
		})
		expect(slugsOf(config).sort()).toEqual([
			'site-cache',
			'site-daily',
			'site-goals',
			'site-hits',
			'site-providers',
			'site-state',
			'site-totals',
		])
	})

	it('keeps the tasks’ leases in jobs.state on an install without native()', async () => {
		const config = await run({
			adapters: [memoryAdapter()],
			sync: true,
			jobs: { state: { slug: 'task-state' } },
		})
		expect(slugsOf(config)).toEqual(['analytics-daily', 'analytics-cache', 'task-state'])
	})

	it('refuses jobs.state where native() registers the state, or no task needs it', async () => {
		await expect(
			run({ adapters: [native()], sync: true, jobs: { state: { slug: 'task-state' } } })
		).rejects.toThrow(
			'jobs.state shapes the analytics-state collection of an install without native(), but native() registers its own ("analytics-state"). Rename or reshape it with native({ collections: { state } }) instead.'
		)
		await expect(
			run({ adapters: [memoryAdapter()], jobs: { state: { slug: 'task-state' } } })
		).rejects.toThrow('this install runs neither. Turn sync or cache.warm on, or remove it.')
	})

	it('fails the boot when an override takes away a field the plugin reads, switched off too', async () => {
		for (const disabled of [false, true]) {
			await expect(
				run({
					disabled,
					adapters: [memoryAdapter()],
					cache: { collection: { overrides: without('key') } },
				})
			).rejects.toThrow(
				'analytics: cache.collection.overrides, on the "analytics-cache" collection, removed the "key" field.'
			)
			await expect(
				run({
					disabled,
					adapters: [memoryAdapter()],
					sync: { collection: { overrides: without('source') } },
				})
			).rejects.toThrow(
				'sync.collection.overrides, on the "analytics-daily" collection, removed the "source" field.'
			)
		}
	})

	it('refuses a field dbName on an engine collection', async () => {
		await expect(
			run({
				adapters: [
					native({
						collections: {
							aggregates: {
								overrides: (collection) => ({
									...collection,
									fields: collection.fields.map((field: Field) =>
										'name' in field && field.name === 'dim'
											? ({ ...field, dbName: 'dimension' } as Field)
											: field
									),
								}),
							},
						},
					}),
				],
			})
		).rejects.toThrow('set a dbName on the "dim" field')
	})

	it('refuses providers or goals with their timestamps off, or renamed by their overrides', async () => {
		await expect(
			run({
				adapters: [memoryAdapter()],
				providers: { collection: { overrides: (c) => ({ ...c, timestamps: false }) } },
			})
		).rejects.toThrow(
			'providers.collection.overrides, on the "analytics-providers" collection, turned off timestamps.'
		)
		await expect(
			run({
				adapters: [memoryAdapter()],
				goals: { collection: { overrides: (c) => ({ ...c, slug: 'goals' }) } },
			})
		).rejects.toThrow('renamed it to "goals". Rename it with goals.collection.slug instead')
	})

	it('takes only a function as overrides', async () => {
		await expect(
			run({
				adapters: [memoryAdapter()],
				providers: { collection: { overrides: { admin: { hidden: true } } as never } },
			})
		).rejects.toThrow(
			'providers.collection.overrides must be a function, (collection) => collection'
		)
	})

	it('measures names against Postgres only on a Postgres install', async () => {
		const long = { collection: { slug: 'c'.repeat(64) } }
		const on = (name: string) => ({ ...fakeConfig(), db: { name } }) as unknown as Config
		await expect(run({ adapters: [memoryAdapter()], cache: long }, on('postgres'))).rejects.toThrow(
			'(64 characters) too long'
		)
		await expect(
			run({ adapters: [memoryAdapter()], cache: long }, on('sqlite'))
		).resolves.toBeDefined()
	})
})
