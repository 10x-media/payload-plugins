import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import type { EpochStore } from '../surfacing/epoch'
import { memoryAdapter } from '../testing/memoryAdapter'
import { MAX_REFRESH_BODY_BYTES, makeRefreshHandler, REFRESH_DEBOUNCE_MS } from './refreshEndpoint'
import { type AnalyticsRuntime, setRuntime } from './runtime'

type ErrorBody = { error: { code: string; message: string; param?: string } }

const epochStore = (overrides: Partial<EpochStore> = {}): EpochStore => ({
	get: async () => '0',
	bump: async () => 'tok-1',
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
		const bump = vi.fn(async () => 'tok-7')
		const res = await makeRefreshHandler()(reqWith(runtimeWith({ epoch: epochStore({ bump }) })))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ epoch: 'tok-7' })
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		expect(bump).toHaveBeenCalledWith(null)
	})

	it('reads the scope out of the body for a caller allowed to name one', async () => {
		const bump = vi.fn(async () => 'tok-3')
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }), platformRead: () => true }), {
				bytes: encode({ scope: 'tenant-b' }),
			})
		)
		expect(res.status).toBe(200)
		expect(bump).toHaveBeenCalledWith('tenant-b')
	})

	it('ignores a body that is not an object, rather than failing the refresh', async () => {
		const bump = vi.fn(async () => 'tok-1')
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }) }), { bytes: encode('nonsense') })
		)
		expect(res.status).toBe(200)
		expect(bump).toHaveBeenCalledWith(null)
	})

	it('413s a body over the cap instead of buffering it', async () => {
		const bump = vi.fn(async () => 'tok-1')
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }) }), {
				contentLength: String(MAX_REFRESH_BODY_BYTES + 1),
			})
		)
		expect(res.status).toBe(413)
		expect(((await res.json()) as ErrorBody).error.code).toBe('payload_too_large')
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		expect(bump).not.toHaveBeenCalled()
	})

	it('400s a scope that is not a string', async () => {
		const res = await makeRefreshHandler()(reqWith(runtimeWith(), { bytes: encode({ scope: 42 }) }))
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('invalid_param')
	})

	it('503s with a retry delay when the token cannot be written', async () => {
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

	it('401s an anonymous request before it reaches the token store', async () => {
		const bump = vi.fn(async () => 'tok-1')
		const req = reqWith(runtimeWith({ epoch: epochStore({ bump }) }))
		const res = await makeRefreshHandler()({
			...req,
			user: null,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(401)
		expect(bump).not.toHaveBeenCalled()
	})

	it('403s a reader the access gate denies', async () => {
		const bump = vi.fn(async () => 'tok-1')
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }), readAccess: () => false }))
		)
		expect(res.status).toBe(403)
		expect(((await res.json()) as ErrorBody).error.code).toBe('forbidden')
		expect(bump).not.toHaveBeenCalled()
	})

	it('refuses a request that resolves no scope on a scoped install', async () => {
		const bump = vi.fn(async () => 'tok-1')
		const res = await makeRefreshHandler()(
			reqWith(
				runtimeWith({
					epoch: epochStore({ bump }),
					scoped: true,
					resolveScope: async () => null,
					platformRead: () => false,
				})
			)
		)
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error).toMatchObject({
			code: 'untrusted_scope',
			param: 'scope',
		})
		expect(bump).not.toHaveBeenCalled()
	})

	it('reads whitespace as no scope at all, rather than as a named one', async () => {
		const bump = vi.fn(async () => 'tok-4')
		const res = await makeRefreshHandler()(
			reqWith(runtimeWith({ epoch: epochStore({ bump }), platformRead: () => false }), {
				bytes: encode({ scope: '   ' }),
			})
		)
		expect(res.status).toBe(200)
		expect(bump).toHaveBeenCalledWith(null)
	})
})

describe('makeRefreshHandler debounce', () => {
	const clocked = (): {
		handler: ReturnType<typeof makeRefreshHandler>
		tick: (ms: number) => void
	} => {
		let at = 1_000
		return {
			handler: makeRefreshHandler({ now: () => at }),
			tick: (ms) => {
				at += ms
			},
		}
	}

	it('answers the current token without bumping again inside the window', async () => {
		const bump = vi.fn(async () => 'tok-9')
		const runtime = runtimeWith({ epoch: epochStore({ bump, get: async () => 'tok-9' }) })
		const { handler, tick } = clocked()

		expect((await handler(reqWith(runtime))).status).toBe(200)
		tick(REFRESH_DEBOUNCE_MS - 1)
		const res = await handler(reqWith(runtime))

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ epoch: 'tok-9' })
		expect(bump).toHaveBeenCalledTimes(1)
	})

	it('bumps again once the window has passed', async () => {
		const bump = vi.fn(async () => 'tok-9')
		const runtime = runtimeWith({ epoch: epochStore({ bump }) })
		const { handler, tick } = clocked()

		await handler(reqWith(runtime))
		tick(REFRESH_DEBOUNCE_MS)
		await handler(reqWith(runtime))

		expect(bump).toHaveBeenCalledTimes(2)
	})

	it('debounces one scope at a time', async () => {
		const bump = vi.fn<EpochStore['bump']>(async () => 'tok-9')
		const runtime = runtimeWith({ epoch: epochStore({ bump }), platformRead: () => true })
		const { handler } = clocked()

		await handler(reqWith(runtime, { bytes: encode({ scope: 'tenant-a' }) }))
		await handler(reqWith(runtime, { bytes: encode({ scope: 'tenant-b' }) }))
		await handler(reqWith(runtime, { bytes: encode({ scope: 'tenant-a' }) }))

		expect(bump.mock.calls.map((call) => call[0])).toEqual(['tenant-a', 'tenant-b'])
	})
})
