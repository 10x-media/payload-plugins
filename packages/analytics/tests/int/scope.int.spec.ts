import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { getRuntime, resolveRegistryFor, resolveScopeFor } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'

describeForDb('analytics scope seam', { dbs: ['mongo'] }, (db) => {
	const mem = memoryAdapter()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [mem],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
			}),
			db,
		})
		mem.record({ path: '/p', timestamp: new Date(), visitor: 'v1' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const reqWithTenant = (tenant?: string): PayloadRequest =>
		({
			payload: booted.payload,
			headers: new Headers(tenant ? { 'x-tenant': tenant } : {}),
		}) as unknown as PayloadRequest

	it('resolves the request scope through the configured scopeResolver', async () => {
		const runtime = getRuntime(booted.payload)
		expect(runtime).toBeDefined()
		if (!runtime) return
		expect(await resolveScopeFor(runtime, reqWithTenant('t1'))).toBe('t1')
		expect(await resolveScopeFor(runtime, reqWithTenant())).toBeNull()
	})

	it('resolves the static config registry for every scope', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		const forNull = await resolveRegistryFor(runtime, { payload: booted.payload, scope: null })
		const forTenant = await resolveRegistryFor(runtime, { payload: booted.payload, scope: 't1' })
		expect(forNull.default().id).toBe('memory')
		expect(forTenant.default().id).toBe('memory')
		expect(forTenant.all()).toEqual(forNull.all())
	})

	it('reads identically for scoped and unscoped requests against a scope-agnostic adapter', async () => {
		const now = new Date()
		const unscoped = await readForWidget({
			req: reqWithTenant(),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now,
		})
		const scoped = await readForWidget({
			req: reqWithTenant('t1'),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now,
		})
		expect(unscoped.status).toBe('ok')
		expect(scoped.status).toBe('ok')
		expect(scoped.metrics.pageviews).toBe(unscoped.metrics.pageviews)
	})
})

describeForDb(
	'analytics scope seam: runtime provider instance routing',
	{ dbs: ['mongo'] },
	(db) => {
		const seeded = memoryAdapter()
		let booted: BootedPayload

		beforeAll(async () => {
			seeded.record({ path: '/p', timestamp: new Date(), visitor: 'v1' })
			booted = await bootPayload({
				plugin: analytics({
					adapters: [memoryAdapter()],
					providers: {
						resolve: async () => [{ ...seeded, id: 'memory:doc9', label: 'Instance' }],
					},
				}),
				db,
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		const req = (): PayloadRequest => ({ payload: booted.payload }) as unknown as PayloadRequest

		it('resolves an instance-id adapter through the registry and serves a read', async () => {
			const runtime = getRuntime(booted.payload)
			if (!runtime) throw new Error('runtime missing')
			const registry = await resolveRegistryFor(runtime, { payload: booted.payload, scope: null })
			expect(registry.get('memory:doc9').id).toBe('memory:doc9')

			const result = await readForWidget({
				req: req(),
				metrics: ['pageviews'],
				timeframe: 'last7days',
				adapterId: 'memory:doc9',
				now: new Date(),
			})
			expect(result.status).toBe('ok')
			expect(result.adapterId).toBe('memory:doc9')
		})

		it('degrades an unknown instance id to unavailable instead of throwing', async () => {
			const result = await readForWidget({
				req: req(),
				metrics: ['pageviews'],
				timeframe: 'last7days',
				adapterId: 'memory:doc404',
				now: new Date(),
			})
			expect(result.status).toBe('unavailable')
		})
	}
)
