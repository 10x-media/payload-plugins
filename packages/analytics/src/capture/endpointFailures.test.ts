import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { makeProxyHandler } from './proxyEndpoint'
import { makeTrackerHandler } from './trackerEndpoint'

vi.mock('./trackerConfig', () => ({
	resolveTrackerConfig: () => Promise.reject(new Error('goals store is down')),
}))

vi.mock('./slots', async (original) => ({
	...(await original<typeof import('./slots')>()),
	resolveSlotAdapter: () => Promise.reject(new Error('registry is down')),
}))

const requestTo = (url: string) => {
	const logger = { warn: vi.fn(), error: vi.fn() }
	const payload = { logger, config: {} } as unknown as Payload
	const runtime: AnalyticsRuntime = {
		registry: createRegistry([memoryAdapter()]),
		configAdapterIds: new Set(['memory']),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: true,
	}
	setRuntime(payload, runtime)
	const req = Object.assign(new Request(url), {
		payload,
		routeParams: { slot: 'global' },
	}) as unknown as PayloadRequest
	return { req, logger }
}

describe('public capture endpoints failing inside', () => {
	it('answers the tracker config as the 500 envelope rather than throwing to Payload', async () => {
		const { req, logger } = requestTo('http://x/api/_x/config')
		const res = await makeTrackerHandler()(req)
		expect(res.status).toBe(500)
		expect(res.headers.get('cache-control')).toBe('private, no-store')
		expect(await res.json()).toEqual({
			error: { code: 'internal', message: 'analytics: tracker config failed' },
		})
		expect(logger.error).toHaveBeenCalledTimes(1)
	})

	it('answers the capture proxy bodyless with a 500 rather than throwing to Payload', async () => {
		const { req, logger } = requestTo('http://x/api/_x/p/global/e')
		const res = await makeProxyHandler('/_x/p')(req)
		expect(res.status).toBe(500)
		expect(await res.text()).toBe('')
		expect(logger.warn).toHaveBeenCalledTimes(1)
	})
})
