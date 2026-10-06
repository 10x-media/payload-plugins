import { inMemoryKVAdapter, type KVAdapter, type Payload, type PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { createEpochStore, type EpochStore, INITIAL_EPOCH } from '../surfacing/epoch'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForWidgetRealtime } from './readForWidgetRealtime'

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

const setup = (
	adapter: AnalyticsAdapter
): { req: PayloadRequest; kv: KVAdapter; epoch: EpochStore } => {
	const kv = inMemoryKVAdapter().init({} as never)
	const payload = { kv, logger: { warn: () => {} } } as unknown as Payload
	const epoch = createEpochStore(payload)
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
		epoch,
	} as AnalyticsRuntime)
	return { req: { payload } as PayloadRequest, kv, epoch }
}

const read = (req: PayloadRequest, scope: string) =>
	readForWidgetRealtime({ req, metric: 'visitors', windowMinutes: 30, now: NOW, scope })

describe('readForWidgetRealtime cache key', () => {
	it('carries the scope epoch in the key it builds outside the engine', async () => {
		const { req, kv, epoch } = setup(realtimeAdapter())
		await read(req, 'tenant-a')
		const keys = (await kv.keys()).filter((key) => key.startsWith('rt:'))
		expect(keys).toHaveLength(1)
		expect(keys[0]?.startsWith(`rt:e${INITIAL_EPOCH}:realtime-source:visitors:30:`)).toBe(true)

		const bumped = await epoch.bump('tenant-a')
		await read(req, 'tenant-a')
		expect((await kv.keys()).filter((key) => key.startsWith(`rt:e${bumped}:`))).toHaveLength(1)
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
