import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { refreshProviders } from './refresh'

const setup = () => {
	const sessions: Record<string, unknown> = {}
	const payload = { db: { sessions }, logger: { warn: vi.fn() } } as unknown as Payload
	const bumped: Array<string | null> = []
	const kept: Promise<unknown>[] = []
	const runtime: AnalyticsRuntime = {
		registry: createRegistry([memoryAdapter()]),
		configAdapterIds: new Set(['memory']),
		bindings: {},
		ttl: {},
		comparison: true,
		engine: {
			read: async (adapter, query) => adapter.query(query, {}),
			keep: (work) => {
				kept.push(work)
			},
		},
		refreshProviders: async (scope) => {
			bumped.push(scope)
		},
	}
	setRuntime(payload, runtime)
	return { payload, sessions, bumped, kept }
}

describe('refreshProviders', () => {
	it('bumps the scope’s token at once outside a transaction', async () => {
		const { payload, bumped, kept } = setup()
		await refreshProviders(payload, 'tenant-a')
		await refreshProviders(payload, 'tenant-b', { req: {} as PayloadRequest })
		expect(bumped).toEqual(['tenant-a', 'tenant-b'])
		expect(kept).toEqual([])
	})

	it('waits for the save’s transaction to end when called inside it, and resolves at once', async () => {
		const { payload, sessions, bumped, kept } = setup()
		sessions['tx-1'] = {}
		const req = { transactionID: 'tx-1' } as unknown as PayloadRequest
		await refreshProviders(payload, 'tenant-a', { req })
		expect(bumped).toEqual([])
		expect(kept).toHaveLength(1)
		await new Promise((resolve) => setTimeout(resolve, 120))
		expect(bumped).toEqual([])
		delete sessions['tx-1']
		await kept[0]
		expect(bumped).toEqual(['tenant-a'])
	})
})
