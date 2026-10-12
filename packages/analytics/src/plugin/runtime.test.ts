import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { hasMethods } from '../core/values'
import type { Goal } from '../goals/types'
import { analytics } from '../index'
import { nativeInstanceOf } from '../native/engine/instance'
import { trackServerEvent } from '../native/ingest/serverTrack'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { ANALYTICS_CONFIG_KEY } from './routes'
import type { AnalyticsRuntime, RuntimeFactory } from './runtime'
import {
	getRuntime,
	RUNTIME_RETIRE_GRACE_MS,
	requestCurrency,
	requestTimezone,
	resolveGoalsDetailedFor,
	resolveGoalsFor,
	resolveTimezoneFor,
	runtimeFactoryOf,
	scopeGates,
	setRuntime,
	settleRetiredRuntimes,
} from './runtime'

const goal: Goal = { slug: 'demo', name: 'Demo', match: { kind: 'goal' } }
const req = {} as PayloadRequest

const runtimeWith = (partial: Partial<AnalyticsRuntime>): AnalyticsRuntime =>
	partial as AnalyticsRuntime

/** An adapter whose `close` is observable, standing in for one holding a buffer or a client. */
const closable = (id: string): AnalyticsAdapter & { close: ReturnType<typeof vi.fn> } => ({
	...memoryAdapter(),
	id,
	close: vi.fn(async () => undefined),
	attach: vi.fn(),
})

/** A config carrying a factory that builds a runtime around `adapters`, attaching each one. */
const configWith = (adapters: AnalyticsAdapter[]) => {
	const factory: RuntimeFactory = {
		create: vi.fn((payload: Payload) => {
			for (const adapter of adapters) {
				adapter.attach?.(payload)
			}
			return runtimeWith({ adapters })
		}),
		validate: async () => undefined,
	}
	return { config: { custom: { [ANALYTICS_CONFIG_KEY]: factory } }, factory }
}

const payloadWith = (config: unknown, warn = vi.fn()): Payload =>
	({ config, logger: { warn } }) as unknown as Payload

const isClosable = (value: unknown): value is { close: () => void } => hasMethods(value, ['close'])

describe('runtimeFactoryOf', () => {
	it('finds the factory the plugin left in config.custom and nothing else', () => {
		const { config, factory } = configWith([])
		expect(runtimeFactoryOf(config)).toBe(factory)
		expect(runtimeFactoryOf(undefined)).toBeUndefined()
		expect(runtimeFactoryOf({ custom: {} })).toBeUndefined()
		expect(runtimeFactoryOf({ custom: { [ANALYTICS_CONFIG_KEY]: { create: () => null } } })).toBe(
			undefined
		)
	})
})

describe('getRuntime', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('builds the runtime on first use, without onInit, and keeps it for the same config', () => {
		const adapter = closable('a')
		const { config, factory } = configWith([adapter])
		const payload = payloadWith(config)
		const runtime = getRuntime(payload)
		expect(runtime?.adapters).toEqual([adapter])
		expect(adapter.attach).toHaveBeenCalledWith(payload)
		expect(getRuntime(payload)).toBe(runtime)
		expect(factory.create).toHaveBeenCalledTimes(1)
	})

	it('answers undefined where the plugin is not installed', () => {
		expect(getRuntime(payloadWith({ custom: {} }))).toBeUndefined()
		expect(getRuntime(payloadWith(undefined))).toBeUndefined()
	})

	// One config, two instances on two databases: a native engine kept anywhere but on its own
	// instance would write one instance's hits to the other's database, or read them from it.
	it('keeps one runtime per instance, each instance of one config on its own database', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'analytics-runtime-'))
		const urls = [`file:${join(dir, 'a.db')}`, `file:${join(dir, 'b.db')}`]
		let opened = 0
		const sqlite = sqliteAdapter({ client: { url: urls[0] ?? '' } })
		const db: typeof sqlite = {
			...sqlite,
			init: (args) => sqliteAdapter({ client: { url: urls[opened++] ?? '' } }).init(args),
		}
		vi.stubEnv('PAYLOAD_FORCE_DRIZZLE_PUSH', 'true')
		const engine = native()
		const config = await buildConfig({
			secret: 'test-secret-not-for-prod',
			db,
			collections: [],
			typescript: { autoGenerate: false, outputFile: '/dev/null' },
			admin: { importMap: { autoGenerate: false } },
			telemetry: false,
			plugins: [analytics({ adapters: [engine], capture: { gate: 'off' } })],
		})
		const instances: Payload[] = []
		try {
			for (const key of ['runtime-two-a', 'runtime-two-b']) {
				instances.push(await getPayload({ config, key }))
			}
			const [first, second] = instances
			if (!first || !second) {
				throw new Error('both instances booted')
			}
			expect(first.config).toBe(second.config)
			expect(getRuntime(first)).not.toBe(getRuntime(second))
			expect(nativeInstanceOf(first)?.store).not.toBe(nativeInstanceOf(second)?.store)

			const hit = { type: 'pageview', hostname: 'a.example' } as const
			await trackServerEvent(first, { ...hit, path: '/first' })
			await trackServerEvent(second, { ...hit, path: '/second' })
			await trackServerEvent(second, { ...hit, path: '/second' })

			const now = Date.now()
			const read = (payload: Payload) =>
				engine.query(
					{
						metrics: ['pageviews'],
						dimensions: ['page'],
						dateRange: { start: new Date(now - 3_600_000), end: new Date(now + 60_000) },
					},
					{ payload }
				)
			expect((await read(first)).rows).toEqual([
				{ dimensions: { page: '/first' }, metrics: { pageviews: 1 } },
			])
			expect((await read(second)).rows).toEqual([
				{ dimensions: { page: '/second' }, metrics: { pageviews: 2 } },
			])
		} finally {
			for (const instance of instances) {
				await instance.destroy()
				// Payload leaves the libsql client open, and an open one keeps its file.
				const client: unknown = Reflect.get(instance.db, 'client')
				if (isClosable(client)) {
					client.close()
				}
			}
			vi.unstubAllEnvs()
			await rm(dir, { recursive: true, force: true })
		}
	}, 60_000)

	it('rebuilds once payload.config is replaced, closing the old adapters after the grace', async () => {
		vi.useFakeTimers()
		const old = closable('old')
		const fresh = closable('fresh')
		const payload = payloadWith(configWith([old]).config)
		const retired = getRuntime(payload)
		Reflect.set(payload, 'config', configWith([fresh]).config)
		const rebuilt = getRuntime(payload)
		expect(rebuilt).not.toBe(retired)
		expect(rebuilt?.adapters).toEqual([fresh])
		expect(old.close).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(RUNTIME_RETIRE_GRACE_MS)
		expect(old.close).toHaveBeenCalledTimes(1)
		expect(fresh.close).not.toHaveBeenCalled()
	})

	it('closes the old adapters at once when asked to settle, and only once', async () => {
		const old = closable('old')
		const payload = payloadWith(configWith([old]).config)
		getRuntime(payload)
		Reflect.set(payload, 'config', configWith([closable('fresh')]).config)
		getRuntime(payload)
		await settleRetiredRuntimes(payload)
		await settleRetiredRuntimes(payload)
		expect(old.close).toHaveBeenCalledTimes(1)
	})

	it('leaves open an adapter the new runtime still uses', async () => {
		const shared = closable('shared')
		const dropped = closable('dropped')
		const payload = payloadWith(configWith([shared, dropped]).config)
		getRuntime(payload)
		Reflect.set(payload, 'config', configWith([shared]).config)
		getRuntime(payload)
		await settleRetiredRuntimes(payload)
		expect(shared.close).not.toHaveBeenCalled()
		expect(dropped.close).toHaveBeenCalledTimes(1)
	})

	it('logs an adapter that fails to close rather than throwing', async () => {
		const failing = closable('failing')
		failing.close.mockRejectedValue(new Error('socket gone'))
		const warn = vi.fn()
		const payload = payloadWith(configWith([failing]).config, warn)
		getRuntime(payload)
		Reflect.set(payload, 'config', configWith([]).config)
		getRuntime(payload)
		await expect(settleRetiredRuntimes(payload)).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"failing" adapter.*socket gone/))
	})

	it('closes the retired runtime itself after the grace, its connection pool included', async () => {
		vi.useFakeTimers()
		const close = vi.fn(async () => undefined)
		const factory: RuntimeFactory = {
			create: () => runtimeWith({ adapters: [], close }),
			validate: async () => undefined,
		}
		const payload = payloadWith({ custom: { [ANALYTICS_CONFIG_KEY]: factory } })
		getRuntime(payload)
		Reflect.set(payload, 'config', configWith([]).config)
		getRuntime(payload)
		expect(close).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(RUNTIME_RETIRE_GRACE_MS)
		expect(close).toHaveBeenCalledTimes(1)
	})

	it('logs a runtime that fails to close rather than throwing', async () => {
		const warn = vi.fn()
		const factory: RuntimeFactory = {
			create: () =>
				runtimeWith({
					adapters: [],
					close: async () => {
						throw new Error('pool stuck')
					},
				}),
			validate: async () => undefined,
		}
		const payload = payloadWith({ custom: { [ANALYTICS_CONFIG_KEY]: factory } }, warn)
		getRuntime(payload)
		Reflect.set(payload, 'config', configWith([]).config)
		getRuntime(payload)
		await expect(settleRetiredRuntimes(payload)).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/connections failed: .*pool stuck/))
	})

	it('serves a hand-built runtime for the config it was set under', () => {
		const payload = payloadWith(configWith([]).config)
		const runtime = runtimeWith({ goals: [goal] })
		setRuntime(payload, runtime)
		expect(getRuntime(payload)).toBe(runtime)
	})
})

describe('resolveGoalsFor', () => {
	it('asks the resolver when the runtime carries one', async () => {
		const merged: Goal[] = [goal, { ...goal, slug: 'from-collection' }]
		const runtime = runtimeWith({ goals: [goal], resolveGoals: async () => merged })
		expect(await resolveGoalsFor(runtime, req, 'tenant-a')).toBe(merged)
	})

	it('falls back to the config goals, then to none', async () => {
		expect(await resolveGoalsFor(runtimeWith({ goals: [goal] }), req)).toEqual([goal])
		expect(await resolveGoalsFor(runtimeWith({}), req)).toEqual([])
	})
})

describe('resolveGoalsDetailedFor', () => {
	it('tags the fallback goals as config-sourced', async () => {
		expect(await resolveGoalsDetailedFor(runtimeWith({ goals: [goal] }), req)).toEqual([
			{ goal, source: 'config' },
		])
	})

	it('asks the resolver when the runtime carries one', async () => {
		const detailed = [{ goal, source: 'collection' as const }]
		const runtime = runtimeWith({ goals: [], resolveGoalsDetailed: async () => detailed })
		expect(await resolveGoalsDetailedFor(runtime, req)).toBe(detailed)
	})
})

describe('scopeGates', () => {
	it('evaluates the access check once however many gates consult it', async () => {
		let calls = 0
		const runtime = runtimeWith({
			crossScope: {
				named: () => {
					calls += 1
					return true
				},
			},
		})
		const gates = scopeGates(runtime, req)
		expect(await Promise.all([gates.named(), gates.named(), gates.named()])).toEqual([
			true,
			true,
			true,
		])
		expect(calls).toBe(1)
	})

	it('asks each gate its own access function', async () => {
		const runtime = runtimeWith({
			crossScope: { named: () => false, aggregate: () => true, unscopedSource: () => false },
		})
		const gates = scopeGates(runtime, req)
		expect(await gates.named()).toBe(false)
		expect(await gates.aggregate()).toBe(true)
		expect(await gates.unscopedSource()).toBe(false)
	})

	it('admits only the admin collection through a gate the runtime leaves out', async () => {
		const runtime = runtimeWith({ crossScope: { named: () => true } })
		const payload = { config: { admin: { user: 'users' } } }
		const admin = { user: { id: 1, collection: 'users' }, payload } as unknown as PayloadRequest
		const customer = {
			user: { id: 2, collection: 'customers' },
			payload,
		} as unknown as PayloadRequest
		expect(await scopeGates(runtime, admin).aggregate()).toBe(true)
		expect(await scopeGates(runtime, customer).aggregate()).toBe(false)
		expect(await scopeGates(runtime, req).aggregate()).toBe(false)
	})
})

describe('per-request resolutions', () => {
	const installed = (partial: Partial<AnalyticsRuntime>) => {
		const payload = payloadWith({})
		setRuntime(payload, runtimeWith(partial))
		return { payload, request: () => ({ payload }) as unknown as PayloadRequest }
	}

	it('asks the host for the scope, timezone and currency once per request', async () => {
		const resolveScope = vi.fn(async () => 'tenant-a')
		const resolveTimezone = vi.fn(async () => 'Europe/Berlin')
		const resolveCurrency = vi.fn(async () => 'EUR')
		const { request } = installed({ resolveScope, resolveTimezone, resolveCurrency })
		const dashboard = request()
		for (let widget = 0; widget < 4; widget++) {
			expect(await requestTimezone(dashboard)).toBe('Europe/Berlin')
			expect(await requestCurrency(dashboard)).toBe('EUR')
		}
		expect(resolveScope).toHaveBeenCalledTimes(1)
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
		expect(resolveCurrency).toHaveBeenCalledTimes(1)

		await requestTimezone(request())
		expect(resolveScope).toHaveBeenCalledTimes(2)
		expect(resolveTimezone).toHaveBeenCalledTimes(2)
	})

	it('says once per request that the scope could not be resolved, however many reads asked', async () => {
		const warn = vi.fn()
		const payload = payloadWith({}, warn)
		const resolveScope = vi.fn(async () => {
			throw new Error('no tenant selected')
		})
		setRuntime(payload, runtimeWith({ resolveScope, resolveTimezone: async () => 'UTC' }))
		const req = { payload } as unknown as PayloadRequest
		for (let widget = 0; widget < 5; widget++) {
			expect(await requestTimezone(req)).toBe('UTC')
		}
		expect(resolveScope).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('no tenant selected'))
	})

	it('keeps the request’s own scope, the install-wide one and a named one apart', async () => {
		const resolveTimezone = vi.fn(async (_req: PayloadRequest, scope?: string | null) =>
			scope === undefined ? 'own' : String(scope)
		)
		const runtime = runtimeWith({ resolveTimezone })
		const req = {} as PayloadRequest
		expect(await resolveTimezoneFor(runtime, req)).toBe('own')
		expect(await resolveTimezoneFor(runtime, req, null)).toBe('null')
		expect(await resolveTimezoneFor(runtime, req, 'null')).toBe('null')
		expect(await resolveTimezoneFor(runtime, req, 'tenant-a')).toBe('tenant-a')
		expect(await resolveTimezoneFor(runtime, req, 'tenant-a')).toBe('tenant-a')
		expect(resolveTimezone).toHaveBeenCalledTimes(4)
	})

	it('decides each cross-scope gate once per request across every read that builds its gates', async () => {
		const named = vi.fn(() => true)
		const runtime = runtimeWith({ crossScope: { named } })
		const req = {} as PayloadRequest
		await scopeGates(runtime, req).named()
		await scopeGates(runtime, req).named()
		expect(named).toHaveBeenCalledTimes(1)
		await scopeGates(runtime, {} as PayloadRequest).named()
		expect(named).toHaveBeenCalledTimes(2)
	})
})
