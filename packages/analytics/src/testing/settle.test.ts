import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from './memoryAdapter'
import { settleAnalytics } from './settle'

/** A promise and the function that settles it, to hold background work open for a test. */
const held = () => {
	let release = (): void => undefined
	const done = new Promise<void>((resolve) => {
		release = resolve
	})
	return { done, release }
}

const NATIVE = Symbol.for('@10x-media/analytics/native-engine')

describe('settleAnalytics', () => {
	it('waits for the read engine, the native engine and the write buffer alike', async () => {
		const reads = held()
		const upkeep = held()
		const buffer = held()
		const payload = { config: {} } as unknown as Payload
		const runtime: AnalyticsRuntime = {
			registry: createRegistry([memoryAdapter()]),
			configAdapterIds: new Set(['memory']),
			bindings: {},
			engine: { read: async (adapter, query) => adapter.query(query, {}), idle: () => reads.done },
			ttl: {},
			comparison: true,
		}
		setRuntime(payload, runtime)
		const flush = vi.fn(() => buffer.done)
		Reflect.set(payload, NATIVE, {
			registration: {},
			nudge: () => undefined,
			engine: { read: vi.fn(), realtime: vi.fn(), idle: () => upkeep.done, close: vi.fn() },
			writer: { write: vi.fn(), defer: vi.fn(), flush, close: vi.fn() },
			salts: { forHit: vi.fn(), forDay: vi.fn() },
		})
		let settled = false
		const settling = settleAnalytics(payload).then(() => {
			settled = true
		})
		for (const work of [reads, upkeep]) {
			work.release()
			await Promise.resolve()
			expect(settled).toBe(false)
		}
		buffer.release()
		await settling
		expect(settled).toBe(true)
		expect(flush).toHaveBeenCalledTimes(1)
	})

	// Settling must not start the work it waits for: no runtime is built for an idle instance.
	it('settles at once on an instance whose plugin never ran anything', async () => {
		const create = vi.fn()
		const payload = {
			config: { custom: { '@10x-media/analytics': { create, validate: vi.fn() } } },
		} as unknown as Payload
		await settleAnalytics(payload)
		expect(create).not.toHaveBeenCalled()
		expect(Reflect.ownKeys(payload)).toEqual(['config'])
	})
})
