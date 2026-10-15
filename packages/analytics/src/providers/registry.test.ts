import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import type { FetchLike } from '../core/fetch'
import { type AdapterRegistry, createRegistry } from '../core/registry'
import type { EpochStore } from '../surfacing/epoch'
import { FIXED_CONFIG_EPOCH } from '../surfacing/epoch'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveHostPolicy } from './hosts'
import { PROBE_MEMO_MS, probeEpoch } from './probe'
import { createProviderRegistry, type ProviderPlan } from './registry'
import { noGuardedConnection } from './resolver'

const stub = (id: string): AnalyticsAdapter => ({ ...memoryAdapter(), id })

const native = stub('native')
const base = { adapters: [native, stub('memory')] }
const registry = createRegistry(base.adapters)
const hosts = resolveHostPolicy(undefined)

/**
 * An instance whose providers collection holds `rows`, read through `payload.db.find` alone. A
 * full document read goes through `payload.find`, which fails the test: nothing here needs one.
 */
const instanceWith = (rows: Array<Record<string, unknown>>) => {
	const warn = vi.fn()
	const probeFind = vi.fn(async () => ({ docs: rows }))
	const documentFind = vi.fn(async () => {
		throw new Error('no document is read in full here')
	})
	const payload = {
		collections: { 'analytics-providers': {} },
		db: { find: probeFind, defaultIDType: 'text' },
		find: documentFind,
		logger: { warn },
	} as unknown as Payload
	return { payload, probeFind, documentFind, warn }
}

const collectionPlan: ProviderPlan = {
	kind: 'collection',
	slug: 'analytics-providers',
	scopeField: 'scope',
	nativeAdapter: native,
}

const options = (payload: Payload, plan: ProviderPlan) => ({
	payload,
	plan,
	base,
	registry,
	narrow: (scoped: AdapterRegistry) => scoped,
	hosts,
	fetch: undefined,
	sdks: {},
})

const AT = '2026-10-07T12:00:00.000Z'
const row = (id: string, provider: string, enabled = true) => ({
	id,
	provider,
	enabled,
	updatedAt: AT,
	scope: 'tenant-a',
})

describe('createProviderRegistry: static', () => {
	it('answers the config registry for every scope, on the fixed epoch', async () => {
		const { payload } = instanceWith([])
		const fixed = createProviderRegistry(options(payload, { kind: 'static' }))
		const resolved = await fixed.resolve({ payload, scope: 'tenant-a' })
		expect(resolved.registry).toBe(registry)
		expect(resolved.grants.size).toBe(0)
		expect(await fixed.epoch('tenant-a')).toBe(FIXED_CONFIG_EPOCH)
		expect(fixed.granted).toBeUndefined()
	})
})

describe('createProviderRegistry: providers.resolve', () => {
	const tokens = (): EpochStore & { bumped: Array<string | null | undefined> } => {
		const bumped: Array<string | null | undefined> = []
		return {
			bumped,
			get: async (scope) => `token-${scope ?? 'global'}-${bumped.length}`,
			bump: async (scope) => {
				bumped.push(scope)
				return 'next'
			},
		}
	}

	it('asks the host on every read, with the guarded connection, and grants its adapters to the scope', async () => {
		const { payload } = instanceWith([])
		const guarded: FetchLike = async () => new Response('{}')
		const resolve = vi.fn(async () => [stub('plausible:own')])
		const narrow = vi.fn((scoped: AdapterRegistry) => scoped)
		const host = createProviderRegistry({
			...options(payload, { kind: 'resolve', resolve }),
			narrow,
			fetch: guarded,
			tokens: tokens(),
		})
		const resolved = await host.resolve({ payload, scope: 'tenant-a' })
		await host.resolve({ payload, scope: 'tenant-a' })
		expect(resolve).toHaveBeenCalledTimes(2)
		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ scope: 'tenant-a', fetch: guarded, hosts, sdks: {} })
		)
		expect(resolved.registry.all().map((adapter) => adapter.id)).toEqual([
			'native',
			'memory',
			'plausible:own',
		])
		expect(resolved.grants.get('plausible:own')).toBe('plausible:own')
		expect(narrow).toHaveBeenCalledTimes(2)
	})

	it('hands the host a fetch that refuses everything when the runtime has no guarded one', async () => {
		const { payload } = instanceWith([])
		const resolve = vi.fn(async () => [])
		await createProviderRegistry({
			...options(payload, { kind: 'resolve', resolve }),
		}).resolve({ payload, scope: null })
		expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ fetch: noGuardedConnection }))
	})

	it('keys on the scope’s token, which refresh replaces', async () => {
		const { payload } = instanceWith([])
		const store = tokens()
		const host = createProviderRegistry({
			...options(payload, { kind: 'resolve', resolve: async () => [] }),
			tokens: store,
		})
		expect(await host.epoch('tenant-a')).toBe('token-tenant-a-0')
		await host.refresh('tenant-a')
		expect(store.bumped).toEqual(['tenant-a'])
		expect(await host.epoch('tenant-a')).toBe('token-tenant-a-1')
	})
})

describe('createProviderRegistry: providers collection', () => {
	it('grants the native adapter from the committed rows alone, reading and decrypting no document', async () => {
		const rows = [row('n1', 'native'), row('p1', 'plausible')]
		const { payload, documentFind } = instanceWith(rows)
		const collection = createProviderRegistry(options(payload, collectionPlan))
		expect(await collection.granted?.('tenant-a', 'native')).toBe(true)
		expect(documentFind).not.toHaveBeenCalled()
		const disabled = instanceWith([row('n1', 'native', false)])
		expect(
			await createProviderRegistry(options(disabled.payload, collectionPlan)).granted?.(
				'tenant-a',
				'native'
			)
		).toBe(false)
	})

	it('grants no native adapter on an install that registered none', async () => {
		const { payload, documentFind } = instanceWith([row('n1', 'native')])
		const { nativeAdapter: _none, ...plan } = collectionPlan as Extract<
			ProviderPlan,
			{ kind: 'collection' }
		>
		const collection = createProviderRegistry(
			options(payload, { ...plan, types: ['plausible', 'umami', 'ga4', 'posthog'] })
		)
		expect(await collection.granted?.('tenant-a', 'native')).toBe(false)
		expect(documentFind).not.toHaveBeenCalled()
	})

	it('keys on the hash of the committed rows', async () => {
		const rows = [row('p1', 'plausible')]
		const { payload } = instanceWith(rows)
		const collection = createProviderRegistry(options(payload, collectionPlan))
		expect(await collection.epoch('tenant-a')).toBe(probeEpoch(rows))
	})

	it('keys on an outage token of its own while the rows cannot be read, and says so once a minute', async () => {
		const { payload, probeFind, warn } = instanceWith([])
		probeFind.mockRejectedValue(new Error('db down'))
		const collection = createProviderRegistry(options(payload, collectionPlan))
		const a = await collection.epoch('tenant-a')
		const b = await collection.epoch('tenant-b')
		expect(a).toMatch(/^outage-/)
		expect(b).toMatch(/^outage-/)
		expect(a).not.toBe(b)
		expect(await collection.epoch('tenant-a')).toBe(a)
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('keys a failed probe on the last epoch it read, never on an earlier outage’s token', async () => {
		let at = 0
		const rows = [row('p1', 'plausible')]
		const { payload, probeFind } = instanceWith(rows)
		const collection = createProviderRegistry({
			...options(payload, collectionPlan),
			now: () => at,
		})
		probeFind.mockRejectedValueOnce(new Error('db down'))
		const outage = await collection.epoch('tenant-a')
		expect(outage).toMatch(/^outage-/)
		const healthy = await collection.epoch('tenant-a')
		expect(healthy).toBe(probeEpoch(rows))
		at += PROBE_MEMO_MS
		probeFind.mockRejectedValueOnce(new Error('db down'))
		expect(await collection.epoch('tenant-a')).toBe(healthy)
	})

	it('builds a scope with no enabled document from the config adapters, reading none', async () => {
		const { payload, documentFind } = instanceWith([row('u1', 'umami', false)])
		const collection = createProviderRegistry(options(payload, collectionPlan))
		const resolved = await collection.resolve({ payload, scope: 'tenant-a' })
		expect(resolved.registry.all().map((adapter) => adapter.id)).toEqual(['native', 'memory'])
		expect(documentFind).not.toHaveBeenCalled()
		expect(await collection.resolve({ payload, scope: 'tenant-a' })).toBe(resolved)
	})
})
