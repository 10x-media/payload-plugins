import type { Payload, PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../../core/contract'
import { type AnalyticsRuntime, setRuntime } from '../../plugin/runtime'

const instance = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('payload', async (actual) => ({
	...(await actual<typeof import('payload')>()),
	getPayload: async () => instance.current,
	createLocalReq: async ({ req }: { req: Request }) => req as unknown as PayloadRequest,
}))

const { answerPreflight, receiveBeacon } = await import('./route')

const SHOP = 'https://shop.example'

/** An instance whose native adapter answers with `receive`, listing `SHOP` as an allowed origin. */
const boot = (receive: (req: PayloadRequest) => Promise<Response>) => {
	const error = vi.fn()
	const payload = { logger: { error, warn: vi.fn() } } as unknown as Payload
	const native = {
		id: 'native',
		receive,
		flush: async () => undefined,
		rebuild: async () => undefined,
	} as unknown as AnalyticsAdapter
	setRuntime(payload, {
		adapters: [native],
		allowedOrigins: new Set([SHOP]),
	} as unknown as AnalyticsRuntime)
	instance.current = payload
	return { error }
}

const request = (method: string, origin?: string): Request =>
	new Request('https://cms.example/api/collect', {
		method,
		headers: origin ? { origin } : {},
		...(method === 'POST' ? { body: '{}' } : {}),
	})

const config = {} as never

afterEach(() => {
	vi.restoreAllMocks()
})

describe('answerPreflight', () => {
	it('lets a listed origin post, and caches the answer for a day', async () => {
		boot(async () => new Response(null, { status: 202 }))
		const res = await answerPreflight(request('OPTIONS', SHOP), config, {})
		expect(res.status).toBe(204)
		expect(res.headers.get('access-control-allow-origin')).toBe(SHOP)
		expect(res.headers.get('access-control-allow-methods')).toBe('POST')
		expect(res.headers.get('access-control-allow-headers')).toBe('content-type')
		expect(res.headers.get('access-control-max-age')).toBe('86400')
	})

	it('gives any other origin no CORS header at all', async () => {
		boot(async () => new Response(null, { status: 202 }))
		for (const origin of ['https://evil.example', undefined]) {
			const res = await answerPreflight(request('OPTIONS', origin), config, {})
			expect(res.status).toBe(204)
			expect(res.headers.get('access-control-allow-origin')).toBeNull()
		}
	})
})

describe('receiveBeacon', () => {
	it('echoes a listed origin on the answer, and no other', async () => {
		boot(async () => Response.json({ ok: true }, { status: 202 }))
		const listed = await receiveBeacon(request('POST', SHOP), config, {})
		expect(listed.status).toBe(202)
		expect(listed.headers.get('access-control-allow-origin')).toBe(SHOP)
		expect(await listed.json()).toEqual({ ok: true })
		const other = await receiveBeacon(request('POST', 'https://evil.example'), config, {})
		expect(other.headers.get('access-control-allow-origin')).toBeNull()
	})

	it('answers 500 for a beacon that fails, and logs failures at most once a minute', async () => {
		const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
		const { error } = boot(async () => {
			throw new Error('database gone')
		})
		for (let index = 0; index < 3; index += 1) {
			expect((await receiveBeacon(request('POST'), config, {})).status).toBe(500)
		}
		expect(error).toHaveBeenCalledTimes(1)
		clock.mockReturnValue(1_000_000 + 60_000)
		await receiveBeacon(request('POST'), config, {})
		expect(error).toHaveBeenCalledTimes(2)
		expect(error.mock.calls[1]?.[0]).toMatchObject({
			msg: expect.stringContaining('3 beacons could not be taken'),
		})
	})
})
