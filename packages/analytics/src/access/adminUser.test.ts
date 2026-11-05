import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../core/registry'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { isAdminUser } from './adminUser'
import { readGate } from './readGate'

const payload = { config: { admin: { user: 'users' } } }

const reqAs = (user: Record<string, unknown> | null): PayloadRequest =>
	({ user, payload }) as unknown as PayloadRequest

describe('isAdminUser', () => {
	it('admits a user of the collection the admin panel signs in with', () => {
		expect(isAdminUser({ req: reqAs({ id: 1, collection: 'users' }) })).toBe(true)
	})

	it('refuses a user of any other auth collection', () => {
		expect(isAdminUser({ req: reqAs({ id: 1, collection: 'customers' }) })).toBe(false)
	})

	it('refuses an anonymous request', () => {
		expect(isAdminUser({ req: reqAs(null) })).toBe(false)
	})

	// Neither side known must never compare equal by both being undefined.
	it('refuses when the config names no admin collection', () => {
		const bare = { user: { id: 1 }, payload: {} } as unknown as PayloadRequest
		expect(isAdminUser({ req: bare })).toBe(false)
	})
})

describe('readGate', () => {
	const runtime = (readAccess?: AnalyticsRuntime['readAccess']): AnalyticsRuntime => ({
		registry: createRegistry([memoryAdapter()]),
		configAdapterIds: new Set(),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: true,
		...(readAccess ? { readAccess } : {}),
	})

	it('asks access.read once per request, however many reads ask', async () => {
		let asked = 0
		const gate = runtime(() => {
			asked++
			return true
		})
		const req = reqAs({ id: 1, collection: 'users' })
		expect(await readGate(gate, req)).toBe(true)
		expect(await readGate(gate, req)).toBe(true)
		expect(asked).toBe(1)
	})

	it('defaults to the admin collection', async () => {
		expect(await readGate(runtime(), reqAs({ id: 1, collection: 'users' }))).toBe(true)
		expect(await readGate(runtime(), reqAs({ id: 2, collection: 'customers' }))).toBe(false)
	})

	it('rejects every caller alike when access.read throws', async () => {
		const gate = runtime(() => {
			throw new Error('misconfigured')
		})
		const req = reqAs({ id: 1, collection: 'users' })
		await expect(readGate(gate, req)).rejects.toThrow('misconfigured')
		await expect(readGate(gate, req)).rejects.toThrow('misconfigured')
	})
})
