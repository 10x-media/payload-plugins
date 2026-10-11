import type { Config, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { filterOperatorsFor } from '../core/capabilities'
import type { AdapterRegisterContext } from '../core/contract'
import { resolveJobs } from '../core/jobs'
import { roleOf } from '../plugin/collectionChecks'
import { routePaths } from '../plugin/routes'
import { AGGREGATES_SLUG, HITS_SLUG, STATE_SLUG, STORE_SLUGS } from './collections/slugs'
import { nativeInstanceOf } from './engine/instance'
import { isNativeAdapter, type NativeOptions, native } from './nativeAdapter'
import { beforeMaintainSchedule, MAINTAIN_TASK_SLUG } from './tasks/maintainTask'

const registerContext: AdapterRegisterContext = {
	scoped: false,
	resolveScope: async () => null,
	resolveTimezone: async () => 'UTC',
	resolveTimezoneStrict: async () => 'UTC',
	revenue: { enabled: true, dimension: true, currency: async () => undefined },
	resolveGoals: async () => [],
}

/** A collection model with every method the Mongo stores call, none of which a test here reaches. */
const fakeModel = () => {
	const unused = vi.fn(async () => undefined)
	return {
		collection: {
			collectionName: 'analytics-hits',
			insertMany: unused,
			aggregate: unused,
			findOne: unused,
			distinct: unused,
			bulkWrite: unused,
			deleteMany: unused,
			updateMany: unused,
		},
		findOneAndUpdate: unused,
		updateMany: unused,
		find: unused,
		findOne: unused,
		deleteMany: unused,
		deleteOne: unused,
		bulkWrite: unused,
		distinct: unused,
	}
}

/** An instance on a Mongo adapter the stores can be built on, and nothing behind it. */
const fakePayload = (db: Record<string, unknown> = {}): Payload =>
	({
		db: {
			name: 'mongoose',
			collections: {
				[HITS_SLUG]: fakeModel(),
				[AGGREGATES_SLUG]: fakeModel(),
				[STATE_SLUG]: fakeModel(),
			},
			...db,
		},
		secret: 'test-secret',
		collections: {},
		config: { collections: [] },
		logger: { error: vi.fn(), warn: vi.fn() },
	}) as unknown as Payload

const registered = (options: NativeOptions = {}, context = registerContext) => {
	const adapter = native(options)
	const config = {} as Config
	adapter.register?.(config, context)
	return { adapter, config }
}

describe('native adapter', () => {
	it('advertises visitors, visits, their length, and the country dimension', () => {
		const caps = native().capabilities
		for (const metric of ['pageviews', 'visitors', 'sessions', 'bounceRate', 'visitDuration']) {
			expect(caps.metrics.has(metric as never), metric).toBe(true)
		}
		expect(caps.dimensions.has('country')).toBe(true)
	})

	it('declares exact weeks and months, 30-minute visits, daily visitors summed', () => {
		const caps = native().capabilities
		expect(caps.calendarBuckets).toBe(true)
		expect(caps.minGranularity).toBe('hour')
		expect(caps.semantics).toEqual({ visitors: 'sumOfDaily', sessions: 'inactivity30m' })
		expect(caps.filterLookbackDays).toBe(90)
	})

	// Goals are filterable now that completions are rows a read can match.
	it('serves and filters every dimension the tracker can know, goals included', () => {
		const caps = native().capabilities
		for (const dimension of [
			'referrer',
			'region',
			'city',
			'browser',
			'os',
			'language',
			'utmSource',
			'utmMedium',
			'utmCampaign',
			'utmContent',
			'utmTerm',
			'goal',
		] as const) {
			expect(caps.dimensions.has(dimension)).toBe(true)
			expect(filterOperatorsFor(caps, dimension)).toEqual(['eq', 'contains'])
		}
	})

	it('is configured', () => {
		expect(native().isConfigured()).toBe(true)
	})

	it('refuses a read without the instance it reads from', async () => {
		const range = { start: new Date(), end: new Date() }
		await expect(native().query({ metrics: ['pageviews'], dateRange: range }, {})).rejects.toThrow(
			/reads through the Payload instance in its context/
		)
		await expect(
			native().realtime?.({ metrics: ['visitors'], dateRange: range }, {})
		).rejects.toThrow(/reads through the Payload instance in its context/)
	})

	it('still constructs with a (possibly missing) geo database path', () => {
		expect(typeof native({ geoDbPath: '/nonexistent/GeoLite2-City.mmdb' }).query).toBe('function')
	})

	it('is recognized among a runtime’s adapters by its own seam', () => {
		expect(isNativeAdapter(native())).toBe(true)
		expect(isNativeAdapter({ ...native(), id: 'other' })).toBe(false)
	})
})

describe('native options', () => {
	it('refuses the rollup engine’s retention windows, naming what replaced them', () => {
		expect(() => native(JSON.parse('{"retentionDays":30}'))).toThrow(
			/native\(\) option retentionDays was removed in 1\.0\.0-beta\.12, use retention\.rawDays/
		)
		expect(() => native(JSON.parse('{"rollupRetentionDays":365}'))).toThrow(
			/native\(\) option rollupRetentionDays was removed in 1\.0\.0-beta\.12/
		)
	})

	it('reads raw hits as far back as retention.rawDays says, or for every day with null', () => {
		expect(native({ retention: { rawDays: 30 } }).capabilities.filterLookbackDays).toBe(30)
		expect(native({ retention: { rawDays: null } }).capabilities.filterLookbackDays).toBeNull()
		for (const rawDays of [0, -1, 1.5, Number.NaN]) {
			expect(() => native({ retention: { rawDays } })).toThrow(/retention\.rawDays/)
		}
	})

	it('keeps daily totals for retention.aggregateDays, never fewer days than raw hits', () => {
		expect(() => native({ retention: { aggregateDays: 400 } })).not.toThrow()
		expect(() => native({ retention: { rawDays: 30, aggregateDays: 30 } })).not.toThrow()
		expect(() => native({ retention: { aggregateDays: null } })).not.toThrow()
		expect(() => native({ retention: { rawDays: 90, aggregateDays: 60 } })).toThrow(
			/aggregateDays \(60\) must be at least retention\.rawDays \(90\)/
		)
		expect(() => native({ retention: { rawDays: null, aggregateDays: 365 } })).toThrow(
			/at least retention\.rawDays \(null, every hit kept\)/
		)
		for (const aggregateDays of [0, 2.5, Number.NaN]) {
			expect(() => native({ retention: { aggregateDays } })).toThrow(/retention\.aggregateDays/)
		}
	})

	it('fails the boot on a cap it cannot apply, and takes whole counts or null', () => {
		expect(() => native({ caps: { page: 0 } })).toThrow(/caps\.page must be a whole number/)
		expect(() => native({ caps: JSON.parse('{"pages":10}') })).toThrow(/caps has no "pages"/)
		expect(() => native({ caps: { page: 5000, country: 50, item: null } })).not.toThrow()
	})

	it('fails the boot on buffer limits no buffer could keep', () => {
		expect(() => native({ buffer: { maxSize: 0 } })).toThrow(/buffer\.maxSize/)
		expect(() => native({ buffer: { maxSize: 300, maxPending: 200 } })).toThrow(/maxPending/)
		expect(() => native({ buffer: true })).not.toThrow()
	})

	it('fails the boot on a today no read could use: whole hits from 0, an age of a second or more', () => {
		for (const snapshotAboveHits of [-1, 2.5, Number.NaN]) {
			expect(() => native({ today: { snapshotAboveHits } })).toThrow(
				/today\.snapshotAboveHits must be a whole number of at least 0/
			)
		}
		for (const maxAgeMs of [0, 999, 1500.5]) {
			expect(() => native({ today: { maxAgeMs } })).toThrow(
				/today\.maxAgeMs must be a whole number of at least 1,000/
			)
		}
		expect(() => native({ today: { snapshotAboveHits: 0, maxAgeMs: 1_000 } })).not.toThrow()
		expect(() => native({ today: {} })).not.toThrow()
	})

	it('fails the boot on a SQLite thread mode it does not know', () => {
		expect(() => native({ sqlite: JSON.parse('{"thread":"both"}') })).toThrow(
			/sqlite\.thread must be one of 'auto', 'worker', 'main', got "both"/
		)
		for (const thread of ['auto', 'worker', 'main'] as const) {
			expect(() => native({ sqlite: { thread } })).not.toThrow()
		}
		expect(() => native({ sqlite: {} })).not.toThrow()
	})
})

describe('native capture', () => {
	it('declares no proxy routes and no snippet scripts', () => {
		const capture = native().capture
		expect(capture?.proxy.routes).toEqual([])
		expect(capture?.snippet({ path: '/na' })).toEqual({ scripts: [] })
	})

	it('client is just the native kind, no ingestPath', () => {
		const capture = native({ ingestPath: '/custom/ingest' }).capture
		expect(capture?.client).toEqual({ kind: 'native' })
		expect(JSON.parse(JSON.stringify(capture?.client))).toEqual({ kind: 'native' })
	})

	it('declares where its ingest endpoint listens, default and overridden', () => {
		expect(native().ingest?.path).toBe('/_x/e')
		expect(native({ ingestPath: '/custom/ingest' }).ingest?.path).toBe('/custom/ingest')
	})

	it('mounts its ingest under the base the plugin hands it, unless ingestPath names its own', () => {
		const moved = native()
		const config = {} as Config
		moved.register?.(config, { ...registerContext, routes: routePaths('/stats') })
		expect(moved.ingest?.path).toBe('/stats/e')
		expect(config.endpoints?.map((endpoint) => endpoint.path)).toEqual(['/stats/e'])

		const own = native({ ingestPath: '/collect' })
		own.register?.({} as Config, { ...registerContext, routes: routePaths('/stats') })
		expect(own.ingest?.path).toBe('/collect')
	})

	it('accepts server events alongside the endpoint', () => {
		expect(typeof native().ingest?.track).toBe('function')
	})
})

describe('native registration', () => {
	it('adds the three store collections, the ingest endpoint and the maintenance task, and nothing else', () => {
		const { config } = registered()
		expect(config.collections?.map((collection) => collection.slug)).toEqual([...STORE_SLUGS])
		expect(config.endpoints?.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
			'post /_x/e',
		])
		expect(config.jobs?.tasks?.map((task) => [task.slug, task.schedule, task.retries])).toEqual([
			[
				MAINTAIN_TASK_SLUG,
				[
					{
						cron: '*/15 * * * *',
						queue: 'default',
						hooks: { beforeSchedule: beforeMaintainSchedule },
					},
				],
				0,
			],
		])
		expect(config.onInit).toBeUndefined()
	})

	it('schedules the maintenance task as jobs says, and registers none with jobs: false', () => {
		const tasksOf = (jobs: AdapterRegisterContext['jobs']) =>
			registered({}, { ...registerContext, jobs }).config.jobs?.tasks
		expect(tasksOf(false)).toBeUndefined()
		expect(
			tasksOf(resolveJobs({ queue: 'analytics', tasks: { maintain: { cron: '0 * * * *' } } }))?.[0]
				?.schedule
		).toMatchObject([{ cron: '0 * * * *', queue: 'analytics' }])
		const unscheduled = tasksOf(resolveJobs({ tasks: { maintain: { cron: false } } }))?.[0]
		expect(unscheduled?.slug).toBe(MAINTAIN_TASK_SLUG)
		expect(unscheduled?.schedule).toBeUndefined()
		const config = {} as Config
		config.jobs = { tasks: [{ slug: 'host-task', handler: async () => ({ output: {} }) }] }
		native().register?.(config, registerContext)
		expect(config.jobs?.tasks?.map((task) => task.slug)).toEqual(['host-task', MAINTAIN_TASK_SLUG])
	})

	it('keeps the same collections and task slug for a switched-off install, and nothing that runs', async () => {
		const running = registered({}, registerContext).config
		const kept = {} as Config
		native().registerSchema?.(kept, { jobs: resolveJobs(undefined) })
		expect(kept.collections).toEqual(running.collections)
		expect(kept.endpoints).toBeUndefined()
		expect(kept.jobs?.tasks?.map((task) => task.slug)).toEqual([MAINTAIN_TASK_SLUG])
		const [task] = kept.jobs?.tasks ?? []
		expect(task?.schedule?.[0]).toMatchObject({ cron: '*/15 * * * *', queue: 'default' })
		expect(await task?.schedule?.[0]?.hooks?.beforeSchedule?.({} as never)).toEqual({
			shouldSchedule: false,
		})
		const withoutJobs = {} as Config
		native().registerSchema?.(withoutJobs, { jobs: false })
		expect(withoutJobs.jobs).toBeUndefined()
		expect(withoutJobs.collections).toEqual(running.collections)
	})

	it('declares revenue and items as the install measures them', () => {
		const { adapter: plain } = registered(
			{},
			{
				...registerContext,
				revenue: { ...registerContext.revenue, enabled: false, dimension: false },
			}
		)
		expect(plain.capabilities.metrics.has('revenue')).toBe(false)
		expect(plain.capabilities.dimensions.has('item')).toBe(false)
		const { adapter: shop } = registered(
			{},
			{
				...registerContext,
				revenue: { ...registerContext.revenue, enabled: true, dimension: true },
				items: { collections: new Set(['offers']), pages: true },
			}
		)
		expect(shop.capabilities.metrics.has('revenue')).toBe(true)
		expect(shop.capabilities.dimensions.has('currency')).toBe(true)
		expect(shop.capabilities.dimensions.has('item')).toBe(true)
		expect(shop.capabilities.perItemQuery).toBe(true)
	})

	it('reads by scope on a scoped install', () => {
		const { adapter } = registered({}, { ...registerContext, scoped: true })
		expect(adapter.capabilities.scopedQueries).toBe(true)
		expect(native().capabilities.scopedQueries).toBeUndefined()
	})
})

describe('native collections', () => {
	const renamed: NativeOptions['collections'] = {
		hits: { slug: 'site-hits' },
		aggregates: { slug: 'site-totals', overrides: (c) => ({ ...c, dbName: 'totals' }) },
		state: { slug: 'site-state' },
	}

	it('registers the three under the slugs collections names, each tagged with its role', () => {
		const { config } = registered({ collections: renamed })
		expect(config.collections?.map((collection) => collection.slug)).toEqual([
			'site-hits',
			'site-totals',
			'site-state',
		])
		expect(config.collections?.map(roleOf)).toEqual(['hits', 'aggregates', 'state'])
		expect(config.collections?.[1]?.dbName).toBe('totals')
		const schemaOnly = {} as Config
		native({ collections: renamed }).registerSchema?.(schemaOnly, { jobs: false })
		expect(schemaOnly.collections?.map((collection) => collection.slug)).toEqual([
			'site-hits',
			'site-totals',
			'site-state',
		])
	})

	it('builds its stores on the renamed collections', () => {
		const { adapter } = registered({ collections: renamed })
		const payload = fakePayload({
			collections: {
				'site-hits': fakeModel(),
				'site-totals': fakeModel(),
				'site-state': fakeModel(),
			},
		})
		adapter.attach?.(payload)
		expect(nativeInstanceOf(payload)?.store).toBeDefined()
		const unrenamed = fakePayload({ collections: { [HITS_SLUG]: fakeModel() } })
		expect(() => registered({ collections: renamed }).adapter.attach?.(unrenamed)).toThrow(
			'"site-hits"'
		)
	})

	it('fails the boot on an unknown collection, a bad entry, or one slug twice', () => {
		const refused: Array<[unknown, string]> = [
			[[], 'native() collections must be an object'],
			[
				{ raw: {} },
				'native() collections.raw is not a collection of the engine; it has hits, aggregates, state',
			],
			[{ hits: 'site-hits' }, 'native() collections.hits must be an object'],
			[
				{ hits: { slug: ' ' } },
				'native() collections.hits.slug must be a non-empty collection slug',
			],
			[
				{ state: { overrides: { admin: {} } } },
				'native() collections.state.overrides must be a function',
			],
			[
				{ hits: { slug: 'x' }, state: { slug: 'x' } },
				'name one slug twice (x, analytics-aggregates, x)',
			],
		]
		for (const [collections, message] of refused) {
			expect(() => native({ collections } as NativeOptions), JSON.stringify(collections)).toThrow(
				message
			)
		}
	})

	it('fails the boot when an override takes away a column the engine reads', () => {
		expect(() =>
			registered({
				collections: {
					hits: {
						overrides: (collection) => ({
							...collection,
							fields: collection.fields.filter((field) => !('name' in field) || field.name !== 'v'),
						}),
					},
				},
			})
		).toThrow(
			'analytics: native() collections.hits.overrides, on the "analytics-hits" collection, removed the "v" field.'
		)
	})

	it('hands what an override reopened to the notice it was given', () => {
		const notice = vi.fn()
		native({
			collections: { state: { overrides: (collection) => ({ ...collection, graphQL: {} }) } },
		}).registerSchema?.({} as Config, { jobs: false, notice })
		expect(notice).toHaveBeenCalledWith(
			expect.stringContaining(
				'native() collections.state.overrides, on the "analytics-state" collection, turned on its GraphQL schema'
			)
		)
	})
})

describe('native lifecycle', () => {
	it('builds one engine per instance on attach, and keeps it while the registration stands', () => {
		const { adapter } = registered()
		const first = fakePayload()
		const second = fakePayload()
		adapter.attach?.(first)
		const engine = nativeInstanceOf(first)
		expect(engine).toBeDefined()
		adapter.attach?.(first)
		expect(nativeInstanceOf(first)).toBe(engine)
		adapter.attach?.(second)
		expect(nativeInstanceOf(second)).toBeDefined()
		expect(nativeInstanceOf(second)).not.toBe(engine)
		expect(nativeInstanceOf(second)?.store).not.toBe(engine?.store)
		expect(nativeInstanceOf(second)?.writer).not.toBe(engine?.writer)
	})

	it('builds a fresh engine once the adapter is registered again, as a reload does', () => {
		const { adapter } = registered()
		const payload = fakePayload()
		adapter.attach?.(payload)
		const before = nativeInstanceOf(payload)
		adapter.register?.({} as Config, registerContext)
		adapter.attach?.(payload)
		expect(nativeInstanceOf(payload)).toBeDefined()
		expect(nativeInstanceOf(payload)).not.toBe(before)
	})

	it('declares the filters of the store an instance runs on once attached', () => {
		const { adapter } = registered()
		expect(filterOperatorsFor(adapter.capabilities, 'page')).toEqual(['eq', 'contains'])
		adapter.attach?.(fakePayload())
		expect(filterOperatorsFor(adapter.capabilities, 'page')).toEqual(['eq', 'contains', 'matches'])
	})

	it('refuses Cloudflare D1 at config time and when an instance attaches it', () => {
		const message = /native\(\) does not support Cloudflare D1.*vendor adapters.*work on D1/
		const onD1 = { db: { name: 'd1-sqlite', defaultIDType: 'number', init: vi.fn() } }
		expect(() => native().register?.(onD1 as unknown as Config, registerContext)).toThrow(message)
		const { adapter } = registered()
		const d1 = fakePayload({ name: 'sqlite', packageName: '@payloadcms/db-d1-sqlite' })
		expect(() => adapter.attach?.(d1)).toThrow(message)
		expect(nativeInstanceOf(d1)).toBeUndefined()
		expect(() => adapter.attach?.(fakePayload())).not.toThrow()
	})

	it('warns once at a production boot when MaxMind geo would load maxmind at runtime', () => {
		vi.stubEnv('NODE_ENV', 'production')
		try {
			const { adapter: geoDb } = registered({ geoDbPath: '/data/City.mmdb' })
			const payload = fakePayload()
			geoDb.attach?.(payload)
			geoDb.attach?.(payload)
			expect(payload.logger.warn).toHaveBeenCalledTimes(1)
			expect(payload.logger.warn).toHaveBeenCalledWith(expect.stringContaining('sdks.maxmind'))

			const { adapter: handed } = registered(
				{ geoDbPath: '/data/City.mmdb' },
				{ ...registerContext, sdks: { maxmind: { open: vi.fn() } as never } }
			)
			const quiet = fakePayload()
			handed.attach?.(quiet)
			registered().adapter.attach?.(quiet)
			expect(quiet.logger.warn).not.toHaveBeenCalled()
		} finally {
			vi.unstubAllEnvs()
		}
	})

	it('closes the engine of the instance it is told, and only the one it built', async () => {
		const { adapter } = registered({ buffer: true })
		const first = fakePayload()
		const second = fakePayload()
		adapter.attach?.(first)
		adapter.attach?.(second)
		const kept = nativeInstanceOf(second)
		await expect(adapter.close?.(first)).resolves.toBeUndefined()
		expect(nativeInstanceOf(first)).toBeUndefined()
		expect(nativeInstanceOf(second)).toBe(kept)
		await expect(adapter.close?.(first)).resolves.toBeUndefined()

		const { adapter: successor } = registered()
		successor.attach?.(second)
		const replaced = nativeInstanceOf(second)
		await adapter.close?.(second)
		expect(nativeInstanceOf(second)).toBe(replaced)
		await successor.close?.(second)
		expect(nativeInstanceOf(second)).toBeUndefined()
	})

	it('flushes the instance it is told, building its engine on first use', async () => {
		const { adapter } = registered({ buffer: true })
		const payload = fakePayload()
		await expect(adapter.flush(payload)).resolves.toBeUndefined()
		expect(nativeInstanceOf(payload)).toBeDefined()
		await adapter.close?.(payload)
	})
})
