import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { requestHostname } from '../../src/native/ingest/requestHost'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime, resolveRegistryFor, resolveScopeFor } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'
import { ingestRequest } from './ingestRequest'

describeForDb('analytics scope seam', {}, (db) => {
	const mem = memoryAdapter()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [mem],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				access: { platformRead: () => true },
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

	it('reads identically for scoped and unscoped requests against a scope-agnostic adapter granted platformRead', async () => {
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

describeForDb('analytics scope seam: runtime provider instance routing', {}, (db) => {
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
})

describeForDb(
	'analytics scope seam: shared config adapter gating vs runtime instance adapters',
	{},
	(db) => {
		const mem = memoryAdapter()
		const seeded = memoryAdapter()
		let booted: BootedPayload

		beforeAll(async () => {
			mem.record({ path: '/p', timestamp: new Date(), visitor: 'v1' })
			seeded.record({ path: '/p', timestamp: new Date(), visitor: 'v1' })
			booted = await bootPayload({
				plugin: analytics({
					adapters: [mem],
					scopeResolver: ({ req }) => req.headers.get('x-tenant'),
					providers: {
						resolve: async () => [{ ...seeded, id: 'memory:doc1', label: 'Instance' }],
					},
				}),
				db,
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		const reqWithTenant = (): PayloadRequest =>
			({
				payload: booted.payload,
				headers: new Headers({ 'x-tenant': 't1' }),
			}) as unknown as PayloadRequest

		it('denies a scoped read through the shared config adapter without platformRead', async () => {
			const result = await readForWidget({
				req: reqWithTenant(),
				metrics: ['pageviews'],
				timeframe: 'last7days',
				now: new Date(),
			})
			expect(result.status).toBe('unavailable')
		})

		it('leaves a scoped read through a runtime instance adapter ungated', async () => {
			const result = await readForWidget({
				req: reqWithTenant(),
				metrics: ['pageviews'],
				timeframe: 'last7days',
				adapterId: 'memory:doc1',
				now: new Date(),
			})
			expect(result.status).toBe('ok')
		})
	}
)

// A scoped install keeps only what a scope answers for: the dev app and any real multi-tenant
// install resolve a public request's tenant from its host, so an unknown host writes nothing.
describeForDb('analytics scope seam: native ingest attribution', {}, (db) => {
	const TENANTS = new Map<string, string>([
		['t1.example', 't1'],
		['t2.example', 't2'],
	])
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ platformHostnames: ['platform.example'] })],
				scopeResolver: ({ req }) => TENANTS.get(req.headers.get('host') ?? '') ?? null,
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = (path: string, host: string) => {
		const endpoint = booted.payload.config.endpoints?.find((e) => e.path === '/analytics/ingest')
		if (!endpoint) {
			throw new Error('ingest endpoint not registered')
		}
		return endpoint.handler(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path, hostname: 'claimed.example' },
				{ host }
			)
		)
	}

	/** Just what attribution decided: the stored hostname and the scope it was stamped with. */
	const rows = async (path: string): Promise<Array<[string, string | undefined]>> => {
		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: path } },
			pagination: false,
		})
		return (docs as unknown as Array<{ hostname: string; scope?: string }>).map((row) => [
			row.hostname,
			row.scope,
		])
	}

	it('drops an unknown host and keeps a tenant host, answering both identically', async () => {
		const kept = await ingest('/scoped', 't1.example')
		const dropped = await ingest('/scoped', 'stranger.example')
		expect(dropped.status).toBe(kept.status)
		expect(await dropped.text()).toBe(await kept.text())
		expect([...dropped.headers].sort()).toEqual([...kept.headers].sort())
		expect(await rows('/scoped')).toEqual([['t1.example', 't1']])
	})

	it('keeps a platform hostname under the null scope', async () => {
		await ingest('/platform', 'platform.example')
		expect(await rows('/platform')).toEqual([['platform.example', '']])
	})
})

const TENANT_BY_HOST = new Map<string, string>([
	['t1.example', 't1'],
	['t2.example', 't2'],
])

/** Attribution and tenancy have to read the same host, or an event lands in another tenant. */
const tenantFor = (req: PayloadRequest, trustedProxyHops?: number): string | null =>
	TENANT_BY_HOST.get(requestHostname(req.headers, { trustedProxyHops }) ?? '') ?? null

const ingestWith = (booted: BootedPayload, path: string, headers: Record<string, string>) => {
	const endpoint = booted.payload.config.endpoints?.find((e) => e.path === '/analytics/ingest')
	if (!endpoint) {
		throw new Error('ingest endpoint not registered')
	}
	return endpoint.handler(
		ingestRequest(booted.payload, { type: 'pageview', path, hostname: 'claimed.example' }, headers)
	)
}

const attributionRows = async (
	booted: BootedPayload,
	path: string
): Promise<Array<[string, string | undefined]>> => {
	const { docs } = await booted.payload.find({
		collection: EVENTS_SLUG as never,
		where: { path: { equals: path } },
		pagination: false,
	})
	return (docs as unknown as Array<{ hostname: string; scope?: string }>).map((row) => [
		row.hostname,
		row.scope,
	])
}

describeForDb('analytics scope seam: forwarded host at a trusted hop', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				trustedProxyHops: 1,
				scopeResolver: ({ req }) => tenantFor(req, 1),
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('picks the tenant and the hostname out of x-forwarded-host', async () => {
		await ingestWith(booted, '/forwarded', {
			host: 'proxy.internal',
			'x-forwarded-host': 't1.example',
		})
		expect(await attributionRows(booted, '/forwarded')).toEqual([['t1.example', 't1']])
	})

	it('falls back to Host when the trusted proxy forwarded none', async () => {
		await ingestWith(booted, '/direct', { host: 't2.example' })
		expect(await attributionRows(booted, '/direct')).toEqual([['t2.example', 't2']])
	})

	// A proxy that appends rather than replaces leaves the client's own value at the head of the
	// chain, so the tenant has to come from the trusted end or a visitor picks it.
	it('keeps the proxy tenant when the client prepended another one', async () => {
		await ingestWith(booted, '/prepended', {
			host: 'proxy.internal',
			'x-forwarded-host': 't2.example, t1.example',
		})
		expect(await attributionRows(booted, '/prepended')).toEqual([['t1.example', 't1']])
	})
})

describeForDb('analytics scope seam: forwarded host with no trusted hop', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => tenantFor(req),
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('ignores x-forwarded-host entirely, keeping the Host tenant', async () => {
		await ingestWith(booted, '/untrusted', {
			host: 't1.example',
			'x-forwarded-host': 't2.example',
		})
		expect(await attributionRows(booted, '/untrusted')).toEqual([['t1.example', 't1']])
	})

	it('drops an event a forwarded host would otherwise have claimed a tenant for', async () => {
		await ingestWith(booted, '/spoofed', {
			host: 'proxy.internal',
			'x-forwarded-host': 't1.example',
		})
		expect(await attributionRows(booted, '/spoofed')).toEqual([])
	})
})
