import { inMemoryKVAdapter, type KVAdapter, type Payload, type PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { SYSTEM } from '../access/principal'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import type { AnalyticsAdapter, AnalyticsResult } from '../core/contract'
import { createRegistry } from '../core/registry'
import { HostRefusedError } from '../core/sourceErrors'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { createEpochStore, type EpochStore } from '../surfacing/epoch'
import { createMemo, type Memo } from '../surfacing/memo'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { readForWidgetRealtime, readRealtimeOrThrow } from './readForWidgetRealtime'

const NOW = new Date('2026-06-01T12:00:00Z')

const realtimeAdapter = (): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'realtime-source',
		capabilities: { ...base.capabilities, scopedQueries: true },
		isConfigured: () => true,
		realtime: async () => ({
			rows: [],
			totals: { visitors: 3 },
			meta: { provider: 'realtime-source', fetchedAt: NOW.toISOString() },
		}),
	}
}

const setup = (adapter: AnalyticsAdapter) => {
	const kv: KVAdapter = inMemoryKVAdapter().init({} as never)
	const payload = { kv, logger: { warn: () => {} } } as unknown as Payload
	const epoch: EpochStore = createEpochStore(payload)
	const clock = { at: 0 }
	const memo: Memo<AnalyticsResult> = createMemo({ now: () => clock.at })
	const store = memoryCacheStore()
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
		epoch,
		memo,
		cache: {
			store,
			sweeper: {
				maybeSweep: () => {},
				sweep: async () => ({ ran: true, swept: 0 }),
				idle: async () => {},
			},
		},
	} satisfies AnalyticsRuntime)
	return { req: { payload } as PayloadRequest, kv, epoch, memo, store, clock }
}

const read = (req: PayloadRequest, scope: string) =>
	readForWidgetRealtime({
		req,
		metric: 'visitors',
		windowMinutes: 30,
		now: NOW,
		principal: SYSTEM,
		scope,
	})

describe('readForWidgetRealtime memo', () => {
	it('keeps a live count in memory for the realtime ttl and writes it nowhere else', async () => {
		const adapter = realtimeAdapter()
		const spy = vi.spyOn(adapter, 'realtime')
		const { req, kv, memo, store, clock } = setup(adapter)
		await read(req, 'tenant-a')
		await read(req, 'tenant-a')
		expect(spy).toHaveBeenCalledTimes(1)
		expect(memo.size).toBe(1)
		expect(store.entries.size).toBe(0)
		expect(await kv.keys()).toEqual([])
		clock.at = 300_000
		await read(req, 'tenant-a')
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('sends the next read back to the source after a bump of that scope', async () => {
		const adapter = realtimeAdapter()
		const spy = vi.spyOn(adapter, 'realtime')
		const { req, epoch } = setup(adapter)
		await read(req, 'tenant-a')
		await read(req, 'tenant-a')
		expect(spy).toHaveBeenCalledTimes(1)

		await epoch.bump('tenant-a')
		await read(req, 'tenant-a')
		expect(spy).toHaveBeenCalledTimes(2)
	})

	// Without the path in the key both pages share one entry, so whichever was read first
	// answers for the other until it expires.
	it('keys each page separately, so two pages never share a count', async () => {
		const adapter = realtimeAdapter()
		const spy = vi.spyOn(adapter, 'realtime')
		const { req, memo } = setup(adapter)
		const readPath = (path: string) =>
			readForWidgetRealtime({ req, metric: 'visitors', windowMinutes: 30, now: NOW, path })
		await readPath('/about')
		await readPath('/contact')
		await readPath('/about')
		expect(spy).toHaveBeenCalledTimes(2)
		expect(memo.size).toBe(2)
	})

	it('asks the source for the minutes only when the series is drawn, and keys each apart', async () => {
		const adapter = realtimeAdapter()
		const spy = vi.spyOn(adapter, 'realtime')
		const { req, memo } = setup(adapter)
		await readForWidgetRealtime({ req, metric: 'visitors', windowMinutes: 30, now: NOW })
		await readForWidgetRealtime({
			req,
			metric: 'visitors',
			windowMinutes: 30,
			now: NOW,
			series: false,
		})
		expect(spy.mock.calls.map(([query]) => query.granularity)).toEqual(['minute', undefined])
		expect(memo.size).toBe(2)
	})

	it('leaves another scope cached when one scope is bumped', async () => {
		const adapter = realtimeAdapter()
		const spy = vi.spyOn(adapter, 'realtime')
		const { req, epoch } = setup(adapter)
		await read(req, 'tenant-a')
		await read(req, 'tenant-b')
		expect(spy).toHaveBeenCalledTimes(2)

		await epoch.bump('tenant-b')
		await read(req, 'tenant-a')
		expect(spy).toHaveBeenCalledTimes(2)
	})
})

describe('readForWidgetRealtime failures', () => {
	const failing = (err: Error): AnalyticsAdapter => ({
		...realtimeAdapter(),
		realtime: async () => {
			throw err
		},
	})

	it.each([
		[new ProviderHttpError(401, 'x', 'bad key'), 'misconfigured'],
		[new HostRefusedError('https://stats.internal', 'private'), 'host-refused'],
		[new ProviderHttpError(503, 'x', 'down'), 'busy'],
	] as const)('answers a failed live read as its status rather than throwing (%s)', async (err, status) => {
		const { req } = setup(failing(err))
		await expect(
			readForWidgetRealtime({ req, metric: 'visitors', windowMinutes: 30, now: NOW })
		).resolves.toEqual({ status, adapterId: 'realtime-source', activeNow: 0, series: [] })
	})

	it('throws the failure for the live endpoint, which answers it itself', async () => {
		const { req } = setup(failing(new ProviderHttpError(401, 'x', 'bad key')))
		await expect(
			readRealtimeOrThrow({ req, metric: 'visitors', windowMinutes: 30, now: NOW })
		).rejects.toThrow('bad key')
	})
})
