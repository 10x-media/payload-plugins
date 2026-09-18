import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import type { EpochStore } from '../surfacing/epoch'
import { memoryAdapter } from '../testing/memoryAdapter'
import { MAX_REFRESH_BODY_BYTES, makeRefreshHandler } from './refreshEndpoint'
import { type AnalyticsRuntime, setRuntime } from './runtime'

type ErrorBody = { error: { code: string; message: string; param?: string } }

const epochStore = (overrides: Partial<EpochStore> = {}): EpochStore => ({
	get: async () => 0,
	bump: async () => 1,
	...overrides,
})

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(['memory']),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	epoch: epochStore(),
	...overrides,
})

const logger = { warn: vi.fn() }

const reqWith = (
	runtime: AnalyticsRuntime | null,
	body?: { bytes?: ArrayBuffer; contentLength?: string }
): PayloadRequest => {
	const payload = { logger } as unknown as Payload
	if (runtime) setRuntime(payload, runtime)
	const headers = new Headers(
		body?.contentLength === undefined ? {} : { 'content-length': body.contentLength }
	)
	return {
		user: { id: 1 },
		payload,
		headers,
		...(body?.bytes === undefined ? {} : { arrayBuffer: async () => body.bytes }),
	} as unknown as PayloadRequest
}

const encode = (value: unknown): ArrayBuffer =>
	new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer

describe('makeRefreshHandler', () => {
	it('answers the new epoch for a request with no body at all', async () => {
		const bump = vi.fn(async () => 7)
		const res = await makeRefreshHandler()(reqWith(runtimeWith({ epoch: epochStore({ bump }) })))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ epoch: 7 })
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		expect(bump).toHaveBeenCalledWith(null)
	})

	it('reads the scope out of the body for a caller allowed to name one', async () => {
		const bump = vi.fn(async () => 3)
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }), platformRead: () => true }), {
				bytes: encode({ scope: 'tenant-b' }),
			})
		)
		expect(res.status).toBe(200)
		expect(bump).toHaveBeenCalledWith('tenant-b')
	})

	it('ignores a body that is not an object, rather than failing the refresh', async () => {
		const bump = vi.fn(async () => 1)
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }) }), { bytes: encode('nonsense') })
		)
		expect(res.status).toBe(200)
		expect(bump).toHaveBeenCalledWith(null)
	})

	it('400s a body over the cap instead of buffering it', async () => {
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith(), { contentLength: String(MAX_REFRESH_BODY_BYTES + 1) })
		)
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error).toMatchObject({
			code: 'invalid_param',
			param: 'scope',
		})
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it('400s a scope that is not a string', async () => {
		const res = await makeRefreshHandler()(reqWith(runtimeWith(), { bytes: encode({ scope: 42 }) }))
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('invalid_param')
	})

	it('503s with a retry delay when the counter cannot be raised', async () => {
		const res = await makeRefreshHandler()(
			reqWith(
				runtimeWith({
					epoch: epochStore({
						bump: async () => {
							throw new Error('kv down')
						},
					}),
				})
			)
		)
		expect(res.status).toBe(503)
		expect(((await res.json()) as ErrorBody).error.code).toBe('unavailable')
		expect(res.headers.get('Retry-After')).toBe('30')
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it('503s while the plugin has no runtime to refresh', async () => {
		const res = await makeRefreshHandler()(reqWith(null))
		expect(res.status).toBe(503)
		expect(((await res.json()) as ErrorBody).error.code).toBe('unavailable')
	})

	it('401s an anonymous request before it reaches the counter', async () => {
		const bump = vi.fn(async () => 1)
		const req = reqWith(runtimeWith({ epoch: epochStore({ bump }) }))
		const res = await makeRefreshHandler()({
			...req,
			user: null,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(401)
		expect(bump).not.toHaveBeenCalled()
	})

	it('403s a reader the access gate denies', async () => {
		const bump = vi.fn(async () => 1)
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }), readAccess: () => false }))
		)
		expect(res.status).toBe(403)
		expect(((await res.json()) as ErrorBody).error.code).toBe('forbidden')
		expect(bump).not.toHaveBeenCalled()
	})
})
