import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../goals/types'
import type { ItemIdType } from '../../items/idType'
import { type CalendarDay, calendarDayOf } from '../../timeframe/calendar'
import { TimezoneResolutionError } from '../../timeframe/reportingTimezone'
import { type GeoResolver, noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { orderHitId } from '../store/ids'
import type { HitRow } from '../store/types'
import { type IngestHandlerOptions, type IngestTarget, makeIngestHandler } from './endpoint'
import { itemRefKey, itemRefSignature } from './itemSignature'
import type { ItemIngestOptions } from './normalizeEvent'
import { orderRefKey, signOrderId } from './orderSignature'
import { dedupeKeyFor, MAX_ORDER_ID_LENGTH } from './revenue'

/** A visitor's agent: the handler drops anything the bot filter recognizes before reading a body. */
const VISITOR_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** One Payload instance per logger, as a process serves every beacon from the same one. */
const instances = new WeakMap<(message: string) => void, Payload>()
const quiet = (): void => undefined
const instanceFor = (warn: (message: string) => void = quiet): Payload => {
	const known = instances.get(warn)
	if (known) {
		return known
	}
	const created = { logger: { warn, error: vi.fn() } } as unknown as Payload
	instances.set(warn, created)
	return created
}

/** A real Request, because the handler reads the body stream rather than `req.json()`. */
const beaconOf = (
	body: BodyInit,
	options: { headers?: Record<string, string>; warn?: (message: string) => void } = {}
): PayloadRequest =>
	Object.assign(
		new Request('http://localhost/api/_x/e', {
			method: 'POST',
			body,
			headers: {
				'content-type': 'application/json',
				host: 'site.example',
				'user-agent': VISITOR_UA,
				...options.headers,
			},
		}),
		{ payload: instanceFor(options.warn) }
	) as unknown as PayloadRequest

const rawReq = (body: BodyInit, contentType = 'application/json'): PayloadRequest =>
	beaconOf(body, { headers: { 'content-type': contentType } })

const req = (body: unknown): PayloadRequest => rawReq(JSON.stringify(body))

/**
 * What the handler stores, without a database: each hit as the writer gets it, the local day of
 * each salt it asked for, and the instance each beacon was stored through.
 */
const capture = (items?: ItemIngestOptions) => {
	const hits: HitRow[] = []
	const saltDays: CalendarDay[] = []
	const through: Payload[] = []
	const target: IngestTarget = {
		salts: {
			forHit: async ({ at, zone }) => {
				const tz = await zone()
				const day = calendarDayOf(at, tz)
				saltDays.push(day)
				return { day, tz, salt: `salt:${day}` }
			},
			forDay: async (day) => {
				saltDays.push(day)
				return `salt:${day}`
			},
		},
		writer: {
			// Every hit is kept, and answered as the store would: an id it already holds is a duplicate.
			write: async (hit) => {
				const repeated = hits.some((held) => held.id === hit.id)
				hits.push(hit)
				return { written: repeated ? 0 : 1, duplicates: repeated ? 1 : 0 }
			},
		},
		...(items ? { items } : {}),
	}
	const targetFor = (payload: Payload): IngestTarget => {
		through.push(payload)
		return target
	}
	return { target: targetFor, hits, saltDays, through }
}

const handlerWith = (
	options: Partial<Omit<IngestHandlerOptions, 'target'>> & { goals?: Goal[] } = {}
) => {
	const { goals, ...rest } = options
	const captured = capture()
	const handler = makeIngestHandler({
		geoResolver: noopResolver,
		...rest,
		target: captured.target,
		resolvers: { ...(goals ? { goals: async () => goals } : {}), ...rest.resolvers },
	})
	return { handler, ...captured }
}

describe('makeIngestHandler validation', () => {
	it('returns 400 for an invalid body', async () => {
		const { handler } = handlerWith()
		expect((await handler(req({}))).status).toBe(400)
	})

	it('400s unparseable JSON and a body that is neither object nor array', async () => {
		const { handler } = handlerWith()
		expect((await handler(rawReq('<html>nope</html>'))).status).toBe(400)
		expect((await handler(rawReq(''))).status).toBe(400)
		expect((await handler(rawReq('"pageview"'))).status).toBe(400)
		expect((await handler(rawReq('7'))).status).toBe(400)
		expect((await handler(rawReq('null'))).status).toBe(400)
	})

	it('413s a body over the ingest cap before parsing any of it', async () => {
		const { handler, hits } = handlerWith()
		const oversized = JSON.stringify({
			type: 'pageview',
			path: '/x',
			hostname: 'h',
			props: { note: 'x'.repeat(70_000) },
		})
		expect((await handler(rawReq(oversized))).status).toBe(413)
		expect(hits).toEqual([])
	})

	it('reads a beacon body, which is sent as text/plain', async () => {
		const { handler, hits } = handlerWith()
		const body = JSON.stringify({ type: 'pageview', path: '/beacon', hostname: 'h' })
		expect((await handler(rawReq(body, 'text/plain;charset=UTF-8'))).status).toBe(202)
		expect(hits[0]?.path).toBe('/beacon')
	})

	it('accepts a goal event carrying a name', async () => {
		const { handler, hits } = handlerWith()
		const res = await handler(req({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h' }))
		expect(res.status).toBe(202)
		expect(hits[0]?.type).toBe('goal')
	})

	// Anyone can POST here, and a forged refund would subtract from revenue it never added to,
	// with no way back: revenue semantics belong to `trackServerEvent` alone.
	it('400s a forged revenue flag and a negative value, recording nothing', async () => {
		const { handler, hits } = handlerWith({
			goals: [{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }],
		})
		const forged = {
			type: 'goal',
			name: 'purchase',
			path: '/p',
			hostname: 'h',
			revenue: true,
			value: -5000,
			orderId: 'ord_1',
		}
		const flagged = await handler(req(forged))
		const negative = await handler(req({ ...forged, revenue: undefined }))

		expect(flagged.status).toBe(400)
		expect(await flagged.json()).toMatchObject({ error: { param: 'revenue' } })
		expect(negative.status).toBe(400)
		expect(await negative.json()).toMatchObject({ error: { param: 'value' } })
		expect(hits).toEqual([])
	})

	it('400s a goal event without a name', async () => {
		const { handler } = handlerWith()
		const res = await handler(req({ type: 'goal', path: '/p', hostname: 'h' }))
		expect(res.status).toBe(400)
	})

	it('400s a custom event without a name', async () => {
		const { handler } = handlerWith()
		expect((await handler(req({ type: 'event', path: '/p', hostname: 'h' }))).status).toBe(400)
	})

	it('400s an unknown type and a missing path, and accepts a body with no hostname', async () => {
		const { handler, hits } = handlerWith()
		expect((await handler(req({ type: 'nope', path: '/p', hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: '/p' }))).status).toBe(202)
		expect(hits[0]?.hostname).toBe('site.example')
	})

	it('400s a non-string path, hostname, or name rather than letting it reach matching', async () => {
		const { handler } = handlerWith({
			goals: [{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } }],
		})
		expect((await handler(req({ type: 'pageview', path: {}, hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: ['/p'], hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: '/p', hostname: 7 }))).status).toBe(400)
		expect((await handler(req({ type: 'goal', name: {}, path: '/p', hostname: 'h' }))).status).toBe(
			400
		)
	})

	it('accepts a pageview with no name', async () => {
		const { handler, hits } = handlerWith()
		expect((await handler(req({ type: 'pageview', path: '/p', hostname: 'h' }))).status).toBe(202)
		expect(hits[0]?.name).toBeUndefined()
	})

	it('accepts the event rather than 400ing when optional fields are junk', async () => {
		const { handler, hits } = handlerWith()
		const res = await handler(
			req({
				type: 'pageview',
				path: '/p',
				hostname: 'h',
				value: 'free',
				currency: 'euro',
				scrollDepth: 'half',
				props: 'nope',
			})
		)
		expect(res.status).toBe(202)
		expect(hits[0]?.value).toBeUndefined()
		expect(hits[0]?.currency).toBeUndefined()
		expect(hits[0]?.scrollDepth).toBeUndefined()
		expect(hits[0]?.props).toBeUndefined()
	})

	it('carries value, currency and props through to the stored hit', async () => {
		const { handler, hits } = handlerWith()
		await handler(
			req({
				type: 'goal',
				name: 'purchase',
				path: '/p',
				hostname: 'h',
				value: 30,
				currency: 'USD',
				props: { plan: 'pro' },
			})
		)
		expect(hits[0]).toMatchObject({
			value: 30,
			currency: 'USD',
			props: { plan: 'pro' },
		})
	})

	it('keeps time and scroll on a pageview, and drops them from a goal', async () => {
		const { handler, hits } = handlerWith()
		await handler(req({ type: 'pageview', path: '/p', durationMs: 4000, scrollDepth: 55 }))
		await handler(
			req({ type: 'goal', name: 'purchase', path: '/p', durationMs: 4000, scrollDepth: 55 })
		)
		expect(hits[0]).toMatchObject({ durationMs: 4000, scrollDepth: 55 })
		expect(hits[1]).not.toHaveProperty('durationMs')
		expect(hits[1]).not.toHaveProperty('scrollDepth')
	})
})

describe('makeIngestHandler storage', () => {
	it('stores each hit through the instance the beacon reached, keyed by its time', async () => {
		const { handler, hits, through } = handlerWith()
		const request = req({ type: 'pageview', path: '/p' })
		const before = Date.now()
		expect((await handler(request)).status).toBe(202)
		expect(through).toEqual([request.payload])
		expect(hits).toHaveLength(1)
		expect(hits[0]?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
		expect(hits[0]?.ts.getTime()).toBeGreaterThanOrEqual(before)
		expect(hits[0]?.v).toMatch(/^[A-Za-z0-9_-]{16}$/)
	})

	it('opens a visit for a landing from another site, its referrer kept as a bare host', async () => {
		const { handler, hits } = handlerWith()
		await handler(req({ type: 'pageview', path: '/', referrer: 'https://www.google.com/q?x=1' }))
		expect(hits[0]).toMatchObject({
			landing: true,
			ref: 'google.com',
			source: 'google.com',
			channel: 'organic-search',
		})
		expect(hits[0]).not.toHaveProperty('referrer')
	})

	it('reads a landing from another hostname of its scope as the site’s own page', async () => {
		const asked: string[] = []
		const seen: string[] = []
		const captured = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: (payload) => ({
				...captured.target(payload),
				siteHosts: {
					of: async (scope) => {
						asked.push(scope)
						return new Set(['shop.example'])
					},
					saw: (_scope, hostname) => {
						seen.push(hostname)
					},
				},
			}),
		})
		await handler(req({ type: 'pageview', path: '/', referrer: 'https://shop.example/cart' }))
		await handler(req({ type: 'pageview', path: '/', referrer: 'https://site.example/a' }))
		await handler(req({ type: 'event', name: 'x', path: '/', referrer: 'https://google.com/' }))
		expect(captured.hits.map((hit) => [hit.type, hit.landing, hit.ref ?? null])).toEqual([
			['pageview', false, null],
			['pageview', false, null],
			['event', false, null],
		])
		// Only the pageview from another host asked which hostnames the scope has.
		expect(asked).toEqual([''])
		expect(seen).toEqual(['site.example', 'site.example', 'site.example'])
	})

	it('keys an order by its dedupe key, so a retry meets its own row', async () => {
		const { handler, hits } = handlerWith()
		const order = { type: 'goal', name: 'purchase', path: '/p', value: 9, orderId: 'ord_1' }
		await handler(req(order))
		await handler(req(order))
		expect(hits.map((hit) => hit.id)).toEqual([hits[0]?.id, hits[0]?.id])
		expect(hits[0]?.id).toMatch(/^ow\.[0-9a-f]{64}$/)
	})

	it("tells the engine of a browser order after storing it, so a closed day holding the server's record counts again", async () => {
		const stored: Array<[string, string]> = []
		const captured = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: (payload) => ({
				...captured.target(payload),
				engine: {
					orderStored: async (scope, id) => {
						stored.push([scope, id])
					},
				},
			}),
		})
		await handler(req({ type: 'goal', name: 'purchase', path: '/p', value: 9, orderId: 'ord_1' }))
		await handler(req({ type: 'goal', name: 'purchase', path: '/p', value: 9 }))
		await handler(req({ type: 'pageview', path: '/p' }))
		expect(stored).toEqual([['', captured.hits[0]?.id]])
	})

	it('asks nothing again for a repeated order beacon, which stored nothing', async () => {
		const stored: string[] = []
		const captured = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: (payload) => ({
				...captured.target(payload),
				engine: {
					orderStored: async (_scope, id) => {
						stored.push(id)
					},
				},
			}),
		})
		const order = { type: 'goal', name: 'purchase', path: '/p', value: 9, orderId: 'ord_1' }
		await handler(req(order))
		await handler(req(order))
		await handler(req(order))
		expect(stored).toEqual([captured.hits[0]?.id])
	})

	it("answers before the engine's look at the server record settles, which keepAlive holds past it", async () => {
		const kept: Array<Promise<unknown>> = []
		let release = () => {}
		const held = new Promise<void>((resolve) => {
			release = resolve
		})
		const captured = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: (payload) => ({
				...captured.target(payload),
				engine: { orderStored: () => held },
				keepAlive: (work) => {
					kept.push(work)
				},
			}),
		})
		const res = await handler(
			req({ type: 'goal', name: 'purchase', path: '/p', value: 9, orderId: 'ord_1' })
		)
		expect(res.status).toBe(202)
		expect(kept).toHaveLength(1)
		release()
		await expect(kept[0]).resolves.toBeUndefined()
	})

	it('answers 202 and warns once when the day of the server record cannot be marked', async () => {
		const warn = vi.fn()
		const captured = capture()
		const kept: Array<Promise<unknown>> = []
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: (payload) => ({
				...captured.target(payload),
				engine: {
					orderStored: async () => {
						throw new Error('database down')
					},
				},
				keepAlive: (work) => {
					kept.push(work)
				},
			}),
		})
		const beacon = (orderId: string) =>
			Object.assign(req({ type: 'goal', name: 'purchase', path: '/p', value: 9, orderId }), {
				payload: { logger: { warn } },
			}) as PayloadRequest
		expect((await handler(beacon('ord_1'))).status).toBe(202)
		expect((await handler(beacon('ord_2'))).status).toBe(202)
		await Promise.all(kept)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toContain('could not be marked to be counted again')
	})

	// A 400 only a granted tenant could earn would tell a prober which tenants take beacons.
	it('drops an order id no key can be stored under as a 202, and keys a long provider id', async () => {
		const { handler, hits } = handlerWith()
		const sale = { type: 'goal', name: 'purchase', path: '/p', value: 9 }
		const refused = async (orderId: unknown) => {
			const res = await handler(req({ ...sale, orderId }))
			expect(res.status).toBe(202)
			expect(await res.json()).toEqual({ ok: true })
		}
		await refused('x'.repeat(MAX_ORDER_ID_LENGTH + 1))
		await refused('ord\n1')
		await refused('')
		await refused(42)
		expect(hits).toEqual([])
		const stripe = 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u'
		expect((await handler(req({ ...sale, orderId: stripe }))).status).toBe(202)
		expect(hits[0]?.id).toBe(
			orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: stripe }))
		)
	})

	it('takes an order id the server signed for its scope, refusing an unsigned one when signatures are required', async () => {
		const key = orderRefKey('secret')
		const payload = { secret: 'secret', logger: { warn: vi.fn() } } as unknown as Payload
		const signed = signOrderId(payload, 'ord_9', { scope: 'tenant-a' })
		const otherScope = signOrderId(payload, 'ord_9', { scope: 'tenant-b' })
		const handlerFor = (mode: 'required' | 'optional') => {
			const captured = capture()
			const handler = makeIngestHandler({
				geoResolver: noopResolver,
				target: (each) => ({ ...captured.target(each), orders: { mode, key } }),
				resolvers: { scope: async () => 'tenant-a' },
			})
			return { handler, hits: captured.hits }
		}
		const sale = (orderId: string | undefined) =>
			req({ type: 'goal', name: 'purchase', path: '/p', value: 9, orderId })
		const bare = orderHitId(
			dedupeKeyFor({ origin: 'wire', tenant: 'tenant-a', goal: 'purchase', orderId: 'ord_9' })
		)
		const required = handlerFor('required')
		expect((await required.handler(sale(signed))).status).toBe(202)
		expect((await required.handler(sale('ord_9'))).status).toBe(202)
		expect((await required.handler(sale(otherScope))).status).toBe(202)
		expect(required.hits.map((hit) => hit.id)).toEqual([bare])
		const optional = handlerFor('optional')
		expect((await optional.handler(sale(signed))).status).toBe(202)
		expect((await optional.handler(sale('ord_9'))).status).toBe(202)
		expect(optional.hits.map((hit) => hit.id)).toEqual([bare, bare])
	})

	// A public path answers the same whatever the database did, and the log is told once a minute.
	it('answers 202 when the store refuses a hit, logging the failure at most once a minute', async () => {
		vi.useFakeTimers({ toFake: ['performance'] })
		try {
			const error = vi.fn()
			const payload = { logger: { warn: vi.fn(), error } } as unknown as Payload
			const handler = makeIngestHandler({
				geoResolver: noopResolver,
				target: () => ({
					salts: {
						forHit: async () => ({ day: 20261006, tz: 'UTC', salt: 'salt' }),
						forDay: async () => 'salt',
					},
					writer: {
						write: async () => {
							throw new Error('database down')
						},
					},
				}),
			})
			const beacon = () =>
				Object.assign(req({ type: 'pageview', path: '/p' }), { payload }) as PayloadRequest
			expect((await handler(beacon())).status).toBe(202)
			expect((await handler(beacon())).status).toBe(202)
			expect(error).toHaveBeenCalledTimes(1)
			expect(error.mock.calls[0]?.[0]).toMatchObject({
				err: expect.any(Error),
				msg: expect.stringContaining('1 beacons could not be stored'),
			})
			vi.advanceTimersByTime(60_000)
			await handler(beacon())
			expect(error).toHaveBeenCalledTimes(2)
			expect(error.mock.calls[1]?.[0]).toMatchObject({
				msg: expect.stringContaining('2 beacons could not be stored'),
			})
		} finally {
			vi.useRealTimers()
		}
	})

	it("answers the error envelope when a host resolver throws, rather than Payload's 500", async () => {
		const error = vi.fn()
		const payload = { logger: { warn: vi.fn(), error } } as unknown as Payload
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: () => {
				throw new Error('unreachable: the scope fails first')
			},
			resolvers: {
				scope: async () => {
					throw new Error('tenant lookup down')
				},
			},
		})
		const beacon = () =>
			Object.assign(req({ type: 'pageview', path: '/p' }), { payload }) as PayloadRequest
		const res = await handler(beacon())
		expect(res.status).toBe(500)
		expect(await res.json()).toEqual({
			error: { code: 'internal', message: 'analytics: the beacon failed' },
		})
		await handler(beacon())
		expect(error).toHaveBeenCalledTimes(1)
		expect(error.mock.calls[0]?.[0]).toMatchObject({
			msg: expect.stringContaining('1 beacons could not be taken'),
		})
	})

	// The day a hit is counted on is decided when it is read, so only its visitor's day salt is at
	// stake: the UTC day stands in, and the hit is kept.
	it("hashes a beacon by its UTC day while its scope's timezone has never resolved", async () => {
		const warn = vi.fn()
		const hits: HitRow[] = []
		const salted: CalendarDay[] = []
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			target: () => ({
				salts: {
					forHit: async () => {
						throw new TimezoneResolutionError('analytics: reportingTimezone resolution failed')
					},
					forDay: async (day) => {
						salted.push(day)
						return 'utc-salt'
					},
				},
				writer: {
					write: async (hit) => {
						hits.push(hit)
						return undefined
					},
				},
			}),
		})
		const res = await handler(beaconOf(JSON.stringify({ type: 'pageview', path: '/p' }), { warn }))
		await handler(beaconOf(JSON.stringify({ type: 'pageview', path: '/p' }), { warn }))
		expect(res.status).toBe(202)
		expect(hits).toHaveLength(2)
		expect(salted).toEqual([calendarDayOf(new Date(), 'UTC'), calendarDayOf(new Date(), 'UTC')])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/reportingTimezone has never resolved/)
	})

	it('asks the timezone resolver about the scope the hit is stamped with', async () => {
		const timezone = vi.fn(
			async (_req: PayloadRequest, _scope?: string | null) => 'Pacific/Kiritimati'
		)
		const { handler, saltDays } = handlerWith({
			resolvers: { scope: async () => 't1', timezone },
		})
		await handler(req({ type: 'pageview', path: '/p' }))
		expect(timezone.mock.calls[0]?.[1]).toBe('t1')
		expect(saltDays).toEqual([calendarDayOf(new Date(), 'Pacific/Kiritimati')])
	})
})

describe('makeIngestHandler engagement', () => {
	it("files an engagement at its pageview's start, hashed with that day's salt", async () => {
		const { handler, hits, saltDays } = handlerWith()
		const sinceMs = 23 * 3_600_000
		const before = Date.now()
		await handler(req({ type: 'engagement', path: '/p', durationMs: 2000, sinceMs }))
		const after = Date.now()
		const filed = hits[0]?.ts.getTime() ?? Number.NaN
		expect(filed).toBeGreaterThanOrEqual(before - sinceMs)
		expect(filed).toBeLessThanOrEqual(after - sinceMs)
		expect(saltDays).toEqual([calendarDayOf(new Date(filed), 'UTC')])
		expect(hits[0]?.lastAt?.getTime()).toBeGreaterThanOrEqual(before)
	})

	it('files a pageview a pending gate held at the time it was sent, not when it arrived', async () => {
		const { handler, hits } = handlerWith()
		const ageMs = 2 * 3_600_000
		const before = Date.now()
		await handler(req({ type: 'pageview', path: '/p', ageMs }))
		const after = Date.now()
		const filed = hits[0]?.ts.getTime() ?? Number.NaN
		expect(filed).toBeGreaterThanOrEqual(before - ageMs)
		expect(filed).toBeLessThanOrEqual(after - ageMs)
	})

	it('files an engagement claiming a start it cannot have had when it arrives', async () => {
		const { handler, hits } = handlerWith()
		const before = Date.now()
		await handler(req({ type: 'engagement', path: '/p', durationMs: 2000, sinceMs: -3_600_000 }))
		await handler(
			req({ type: 'engagement', path: '/p', durationMs: 2000, sinceMs: 25 * 3_600_000 })
		)
		await handler(req({ type: 'engagement', path: '/p', durationMs: 2000, sinceMs: '60000' }))
		await handler(req({ type: 'pageview', path: '/p', sinceMs: 60_000 }))
		for (const hit of hits) {
			expect(hit.ts.getTime()).toBeGreaterThanOrEqual(before)
		}
		expect(hits).toHaveLength(4)
	})

	// A single-page app's navigation moves a visit along, so it opens none and keeps no referrer.
	it('takes a navigation mark on a pageview, which counts but opens no visit', async () => {
		const { handler, hits } = handlerWith()
		const res = await handler(
			req({ type: 'pageview', path: '/next', referrer: 'https://google.com/', nav: 1 })
		)
		expect(res.status).toBe(202)
		expect(hits[0]).toMatchObject({
			type: 'pageview',
			path: '/next',
			landing: false,
			source: 'direct',
		})
		expect(hits[0]).not.toHaveProperty('ref')
	})

	it('stores an engagement, which needs no name', async () => {
		const { handler, hits } = handlerWith()
		const res = await handler(
			req({ type: 'engagement', path: '/pricing', durationMs: 4000, scrollDepth: 30 })
		)
		expect(res.status).toBe(202)
		expect(hits[0]).toMatchObject({
			type: 'engagement',
			path: '/pricing',
			durationMs: 4000,
			scrollDepth: 30,
		})
		expect(hits[0]?.name).toBeUndefined()
	})

	it('drops a bad duration or depth without failing the engagement', async () => {
		const { handler, hits } = handlerWith()
		const res = await handler(
			req({ type: 'engagement', path: '/pricing', durationMs: -5, scrollDepth: 30 })
		)
		await handler(req({ type: 'engagement', path: '/pricing', durationMs: 2000, scrollDepth: 'x' }))
		expect(res.status).toBe(202)
		expect(hits[0]).not.toHaveProperty('durationMs')
		expect(hits[0]?.scrollDepth).toBe(30)
		expect(hits[1]?.durationMs).toBe(2000)
		expect(hits[1]).not.toHaveProperty('scrollDepth')
	})

	it('answers an engagement left with nothing to add, and stores nothing', async () => {
		const { handler, hits } = handlerWith()
		const res = await handler(
			req({ type: 'engagement', path: '/pricing', durationMs: 'soon', scrollDepth: 0 })
		)
		expect(res.status).toBe(202)
		expect(hits).toEqual([])
	})

	it('never resolves goals for an engagement, so it completes none', async () => {
		const goals = vi.fn(
			async (): Promise<Goal[]> => [
				{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
			]
		)
		const { handler, hits } = handlerWith({ resolvers: { goals } })
		await handler(req({ type: 'engagement', path: '/thank-you', durationMs: 4000 }))
		expect(goals).not.toHaveBeenCalled()
		expect(hits[0]).not.toHaveProperty('goals')
	})
})

describe('makeIngestHandler modes', () => {
	const located = {
		'x-vercel-ip-country': 'DE',
		'x-vercel-ip-country-region': 'BE',
		'x-vercel-ip-city': 'Berlin',
		'x-real-ip': '9.9.9.9',
	}

	const measured = () =>
		handlerWith({
			geoResolver: platformHeaderResolver,
			attribution: { trustedPlatform: 'vercel' },
		})

	const beacon = (body: Record<string, unknown>): PayloadRequest =>
		beaconOf(JSON.stringify(body), { headers: located })

	it('stores a beacon without a mode as full, and a cookieless one under the same visitor', async () => {
		const { handler, hits } = measured()
		await handler(beacon({ type: 'pageview', path: '/' }))
		await handler(beacon({ type: 'pageview', path: '/', m: 'c' }))
		await handler(beacon({ type: 'pageview', path: '/', m: 'f' }))
		expect(hits.map((hit) => hit.mode)).toEqual(['f', 'c', 'f'])
		expect(new Set(hits.map((hit) => hit.v)).size).toBe(1)
		expect(hits[1]).toMatchObject({ country: 'DE', region: 'BE', city: 'Berlin' })
	})

	it('stores an anonymous pageview with no visitor, country alone, and no time or scroll, whatever it carries', async () => {
		const { handler, hits, saltDays } = measured()
		const res = await handler(
			beacon({
				type: 'pageview',
				path: '/pricing',
				m: 'a',
				referrer: 'https://news.example/story',
				query: 'utm_source=newsletter',
				durationMs: 9000,
				scrollDepth: 0,
			})
		)
		expect(res.status).toBe(202)
		expect(hits).toHaveLength(1)
		expect(hits[0]).toMatchObject({
			mode: 'a',
			v: '',
			country: 'DE',
			ref: 'news.example',
			utmSource: 'newsletter',
		})
		for (const field of ['region', 'city', 'durationMs', 'scrollDepth']) {
			expect(hits[0]).not.toHaveProperty(field)
		}
		expect(saltDays).toEqual([])
	})

	it('stores no anonymous engagement, however much time and scroll it reports', async () => {
		const { handler, hits } = measured()
		const res = await handler(
			beacon({ type: 'engagement', path: '/p', m: 'a', durationMs: 4000, scrollDepth: 40 })
		)
		expect(res.status).toBe(202)
		expect(hits).toEqual([])
	})

	it('400s a mode it does not know, naming m and recording nothing', async () => {
		const { handler, hits } = measured()
		for (const m of ['x', 'full', 1, null, true]) {
			const res = await handler(beacon({ type: 'pageview', path: '/', m }))
			expect(res.status).toBe(400)
			expect(await res.json()).toMatchObject({ error: { param: 'm' } })
		}
		expect(hits).toEqual([])
	})
})

describe('makeIngestHandler content items', () => {
	const key = itemRefKey('test-secret')
	const signed = (ref: string): string => `${ref}@${itemRefSignature(key, ref)}`
	const itemHandler = (idTypes?: ReadonlyMap<string, ItemIdType>) => {
		const captured = capture({
			collections: new Set(['offers']),
			signature: { mode: 'required', key },
			...(idTypes ? { idTypes } : {}),
		})
		const handler = makeIngestHandler({ geoResolver: noopResolver, target: captured.target })
		return { handler, hits: captured.hits }
	}

	it('drops a forged ref whose id the collection could not hold, keeping the event', async () => {
		const { handler, hits } = itemHandler(new Map([['offers', 'objectId']]))
		const real = 'offers:65f0c0ffee0123456789abcd'
		await handler(req({ type: 'event', name: 'item_click', path: '/', item: signed('offers:x') }))
		await handler(req({ type: 'engagement', path: '/', impressions: [signed('offers:x')] }))
		await handler(
			req({ type: 'engagement', path: '/', impressions: [signed('offers:x'), signed(real)] })
		)
		expect(hits.map((hit) => [hit.type, hit.item, hit.impressions])).toEqual([
			['event', undefined, undefined],
			['engagement', undefined, [real]],
		])
	})

	it('stores an engagement carrying only the items it saw as an engagement row', async () => {
		const { handler, hits } = itemHandler()
		const res = await handler(
			req({ type: 'engagement', path: '/', impressions: [signed('offers:1')] })
		)
		expect(res.status).toBe(202)
		expect(hits).toHaveLength(1)
		expect(hits[0]).toMatchObject({ type: 'engagement', impressions: ['offers:1'] })
		expect(hits[0]).not.toHaveProperty('durationMs')
	})

	it('still drops an engagement whose items were all refused, with nothing else in it', async () => {
		const { handler, hits } = itemHandler()
		const res = await handler(
			req({ type: 'engagement', path: '/', impressions: [signed('pages:1'), 'offers:1'] })
		)
		expect(res.status).toBe(202)
		expect(hits).toEqual([])
	})

	it('keeps a bound item on an event and drops any other, keeping the event either way', async () => {
		const { handler, hits } = itemHandler()
		await handler(req({ type: 'event', name: 'item_click', path: '/', item: signed('offers:1') }))
		await handler(req({ type: 'event', name: 'item_click', path: '/', item: signed('users:1') }))
		await handler(req({ type: 'event', name: 'item_click', path: '/', item: 'offers:1' }))
		expect(hits.map((hit) => hit.item)).toEqual(['offers:1', undefined, undefined])
	})

	it('keeps no item at all on an install that binds none', async () => {
		const { handler, hits } = handlerWith()
		await handler(req({ type: 'event', name: 'item_click', path: '/', item: signed('offers:1') }))
		await handler(req({ type: 'engagement', path: '/', impressions: [signed('offers:1')] }))
		expect(hits.map((hit) => hit.item)).toEqual([undefined])
	})
})

describe('makeIngestHandler goal matching', () => {
	const goals: Goal[] = [
		{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' }, value: { prop: 'total' } },
		{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
	]

	it('stamps matched goals on the hit, with what they count', async () => {
		const { handler, hits } = handlerWith({ goals })
		await handler(req({ type: 'pageview', path: '/thank-you', hostname: 'h' }))
		expect(hits[0]).toMatchObject({
			goals: [{ slug: 'thanks', value: 0 }],
			conversions: 1,
			revenue: 0,
		})
	})

	it('resolves a goal value from a prop', async () => {
		const { handler, hits } = handlerWith({ goals })
		await handler(
			req({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', props: { total: 25 } })
		)
		expect(hits[0]?.goals).toEqual([{ slug: 'purchase', value: 25 }])
		expect(hits[0]?.revenue).toBe(25)
	})

	it('resolves goals with the same scope the event is stamped with', async () => {
		const resolveGoals = vi.fn(async (_req: PayloadRequest, _scope?: string | null) => goals)
		const { handler, hits } = handlerWith({
			resolvers: { scope: async () => 't1', goals: resolveGoals },
		})
		await handler(req({ type: 'pageview', path: '/thank-you', hostname: 'h' }))
		expect(resolveGoals.mock.calls[0]?.[1]).toBe('t1')
		expect(hits[0]?.scope).toBe('t1')
	})

	it('ingests normally when no goals resolver is configured', async () => {
		const { handler, hits } = handlerWith()
		expect(
			(await handler(req({ type: 'pageview', path: '/thank-you', hostname: 'h' }))).status
		).toBe(202)
		expect(hits[0]?.goals).toBeUndefined()
	})
})

describe('makeIngestHandler attribution', () => {
	const withHost = (body: unknown, headers: Record<string, string>): PayloadRequest => {
		const request = beaconOf(JSON.stringify(body), { headers })
		if (!('host' in headers)) {
			request.headers.delete('host')
		}
		return request
	}

	const handlerWithAttribution = (
		attribution: IngestHandlerOptions['attribution'],
		resolvers: IngestHandlerOptions['resolvers'] = {}
	) => handlerWith({ attribution, resolvers })

	const pageview = { type: 'pageview', path: '/p', hostname: 'evil.example' }

	it('stores the request host and ignores the body claim and Origin', async () => {
		const { handler, hits } = handlerWithAttribution({})
		const res = await handler(
			withHost(pageview, { host: 'a.example:3000', origin: 'https://other.example' })
		)
		expect(res.status).toBe(202)
		expect(hits[0]?.hostname).toBe('a.example')
	})

	it('answers a drop exactly as it answers an accepted event', async () => {
		const { handler, hits } = handlerWithAttribution({})
		const kept = await handler(withHost(pageview, { host: 'a.example' }))
		const dropped = await handler(withHost(pageview, {}))
		expect(dropped.status).toBe(kept.status)
		expect(await dropped.text()).toBe(await kept.text())
		expect([...dropped.headers].sort()).toEqual([...kept.headers].sort())
		expect(hits).toHaveLength(1)
	})

	it('drops an event whose request resolves no scope on a scoped install', async () => {
		const { handler, hits } = handlerWithAttribution(
			{},
			{
				scope: async (request) => {
					const host = request.headers.get('host') ?? ''
					return host.includes('.') ? (host.split('.')[0] ?? null) : null
				},
			}
		)
		await handler(withHost(pageview, { host: 'unknown' }))
		await handler(withHost(pageview, { host: 't1.example' }))
		expect(hits.map((hit) => [hit.hostname, hit.scope])).toEqual([['t1.example', 't1']])
	})

	it('keeps a platform hostname under the null scope', async () => {
		const { handler, hits } = handlerWithAttribution(
			{ platformHostnames: new Set(['platform.example']) },
			{ scope: async () => null }
		)
		await handler(withHost(pageview, { host: 'platform.example' }))
		await handler(withHost(pageview, { host: 'tenant.example' }))
		expect(hits.map((hit) => [hit.hostname, hit.scope])).toEqual([['platform.example', '']])
	})

	it('reads x-forwarded-host only once a proxy hop is trusted', async () => {
		const forwarded = { host: 'a.example', 'x-forwarded-host': 'b.example' }
		const ignored = handlerWithAttribution({ trustedProxyHops: 0 })
		await ignored.handler(withHost(pageview, forwarded))
		expect(ignored.hits[0]?.hostname).toBe('a.example')

		const trusted = handlerWithAttribution({ trustedProxyHops: 1 })
		await trusted.handler(withHost(pageview, forwarded))
		expect(trusted.hits[0]?.hostname).toBe('b.example')
	})

	it('pays for neither the timezone nor the goals resolver on a drop', async () => {
		const timezone = vi.fn(async () => 'Europe/Berlin')
		const goals = vi.fn(async () => [])
		const { handler } = handlerWithAttribution({}, { timezone, goals })
		await handler(withHost(pageview, {}))
		expect(timezone).not.toHaveBeenCalled()
		expect(goals).not.toHaveBeenCalled()
	})
})

// The response cannot say a drop happened without telling a prober which hosts exist, so the
// log says it instead: once per reason for the life of the process, never once per event.
describe('makeIngestHandler drop warnings', () => {
	const withLogger = (
		headers: Record<string, string>,
		warn: (message: string) => void
	): PayloadRequest => {
		const request = beaconOf(JSON.stringify({ type: 'pageview', path: '/p' }), { headers, warn })
		if (!('host' in headers)) {
			request.headers.delete('host')
		}
		return request
	}

	it('warns once for a refused hostname and stays silent on every later drop', async () => {
		const warn = vi.fn()
		const { handler } = handlerWith()
		await handler(withLogger({}, warn))
		await handler(withLogger({}, warn))
		await handler(withLogger({ host: 'a.example' }, warn))
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/hostname option/)
	})

	it('warns once for an unresolved scope, naming scope.resolve and platformHostnames', async () => {
		const warn = vi.fn()
		const { handler } = handlerWith({ resolvers: { scope: async () => null } })
		await handler(withLogger({ host: 'a.example' }, warn))
		await handler(withLogger({ host: 'b.example' }, warn))
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/scope\.resolve/)
		expect(warn.mock.calls[0]?.[0]).toMatch(/platformHostnames/)
	})

	it('keeps each reason on its own budget', async () => {
		const warn = vi.fn()
		const { handler } = handlerWith({ resolvers: { scope: async () => null } })
		await handler(withLogger({}, warn))
		await handler(withLogger({ host: 'a.example' }, warn))
		expect(warn).toHaveBeenCalledTimes(2)
	})

	// A crawler is expected traffic, not a misconfiguration: it earns no line at all.
	it('says nothing at all about a bot', async () => {
		const warn = vi.fn()
		const { handler, hits } = handlerWith()
		const res = await handler(
			withLogger({ host: 'a.example', 'user-agent': 'Googlebot/2.1' }, warn)
		)
		expect(res.status).toBe(202)
		expect(await res.json()).toEqual({ ok: true })
		expect(hits).toEqual([])
		expect(warn).not.toHaveBeenCalled()
	})

	// A stripped agent zeroes an install's numbers, so it is the one drop worth a line.
	it('warns once for a beacon with no user agent and stays silent after', async () => {
		const warn = vi.fn()
		const { handler, hits } = handlerWith()
		const res = await handler(withLogger({ host: 'a.example', 'user-agent': '' }, warn))
		await handler(withLogger({ host: 'a.example', 'user-agent': '' }, warn))
		expect(res.status).toBe(202)
		expect(hits).toEqual([])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/no user agent/)
	})

	it('keeps the event and warns once when the bot filter throws', async () => {
		const warn = vi.fn()
		const { handler, hits } = handlerWith({
			filterBots: () => {
				throw new Error('boom')
			},
		})
		const res = await handler(withLogger({ host: 'a.example' }, warn))
		await handler(withLogger({ host: 'a.example' }, warn))
		expect(res.status).toBe(202)
		expect(hits).toHaveLength(2)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/filterBots/)
	})
})

describe('makeIngestHandler request trust', () => {
	/** A beacon carrying the given headers, from the instance whose logger is `warn`. */
	const beacon = (headers: Record<string, string>, warn?: (message: string) => void) =>
		beaconOf(JSON.stringify({ type: 'pageview', path: '/p' }), {
			headers,
			...(warn ? { warn } : {}),
		})

	const crossSite = (origin: string) => ({ 'sec-fetch-site': 'cross-site', origin })

	it('answers a cross-site beacon 202, stores nothing, and warns once', async () => {
		const warn = vi.fn()
		const { handler, hits } = handlerWith()
		const res = await handler(beacon(crossSite('https://evil.example'), warn))
		await handler(beacon(crossSite('https://other.example'), warn))
		await handler(beacon({ 'sec-fetch-site': 'cross-site' }, warn))

		expect(res.status).toBe(202)
		expect(await res.json()).toEqual({ ok: true })
		expect(hits).toEqual([])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/capture\.allowedOrigins/)
	})

	it('stores a cross-site beacon from an origin capture.allowedOrigins lists', async () => {
		const { handler, hits } = handlerWith({
			attribution: { allowedOrigins: new Set(['https://partner.example']) },
		})
		expect((await handler(beacon(crossSite('https://partner.example')))).status).toBe(202)
		await handler(beacon(crossSite('https://evil.example')))

		expect(hits).toHaveLength(1)
	})

	it('stores same-origin, same-site, none and unmarked beacons', async () => {
		const { handler, hits } = handlerWith()
		for (const site of ['same-origin', 'same-site', 'none']) {
			await handler(beacon({ 'sec-fetch-site': site, origin: 'https://evil.example' }))
		}
		await handler(beacon({}))

		expect(hits).toHaveLength(4)
	})

	// Tenant subdomains are one site to a browser, so `same-site` alone would let them count into each other.
	it("drops a same-site beacon from a page of another scope, keeping its own scope's and an unknown host's", async () => {
		const warn = vi.fn()
		const tenantOf = async (visitor: PayloadRequest) =>
			({ 'a.platform.example': 'a', 'b.platform.example': 'b' })[
				visitor.headers.get('host') ?? ''
			] ?? null
		const { handler, hits } = handlerWith({ resolvers: { scope: tenantOf } })
		const fromPage = (origin: string) =>
			beacon({ host: 'b.platform.example', 'sec-fetch-site': 'same-site', origin }, warn)

		const res = await handler(fromPage('https://a.platform.example'))
		await handler(fromPage('https://b.platform.example'))
		await handler(fromPage('https://www.platform.example'))

		expect(res.status).toBe(202)
		expect(hits.map((hit) => hit.scope)).toEqual(['b', 'b'])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/same-site/)
	})

	it('reads platform geo for the trusted platform alone', async () => {
		const spoofed = { 'cf-ipcountry': 'KP', 'x-vercel-ip-country': 'US' }
		const captured = capture()
		const untrusted = makeIngestHandler({
			geoResolver: platformHeaderResolver,
			target: captured.target,
		})
		const trusted = makeIngestHandler({
			geoResolver: platformHeaderResolver,
			target: captured.target,
			attribution: { trustedPlatform: 'cloudflare' },
		})
		await untrusted(beacon(spoofed))
		await trusted(beacon(spoofed))

		expect(captured.hits.map((hit) => hit.country)).toEqual([undefined, 'KP'])
	})

	it('warns once about a forwarded chain while neither trust option is set', async () => {
		const warn = vi.fn()
		const { handler } = handlerWith()
		await handler(beacon({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, warn))
		await handler(beacon({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, warn))

		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/neither trustedProxyHops nor trustedPlatform/)
	})
})

describe('makeIngestHandler geo resolver failures', () => {
	const geoWarnings = (warn: ReturnType<typeof vi.fn>) =>
		warn.mock.calls.filter(([message]) => /geo resolver/.test(String(message)))

	it('stores the beacon without a location when the resolver throws, and says so once', async () => {
		const warn = vi.fn()
		const throwing: GeoResolver = () => {
			throw new Error('geo service down')
		}
		const { handler, hits } = handlerWith({ geoResolver: throwing })
		for (const path of ['/a', '/b', '/c']) {
			const beacon = beaconOf(JSON.stringify({ type: 'pageview', path }), { warn })
			expect((await handler(beacon)).status).toBe(202)
		}

		expect(hits.map((hit) => [hit.path, hit.country ?? null])).toEqual([
			['/a', null],
			['/b', null],
			['/c', null],
		])
		expect(geoWarnings(warn)).toHaveLength(1)
		expect(geoWarnings(warn)[0]?.[0]).toMatch(/geo service down/)
	})

	it('says it again an hour on, while the resolver still fails', async () => {
		vi.useFakeTimers()
		try {
			const warn = vi.fn()
			const { handler } = handlerWith({ geoResolver: () => Promise.reject(new Error('down')) })
			const beacon = () => beaconOf(JSON.stringify({ type: 'pageview', path: '/' }), { warn })
			await handler(beacon())
			vi.advanceTimersByTime(59 * 60_000)
			await handler(beacon())
			vi.advanceTimersByTime(2 * 60_000)
			await handler(beacon())

			expect(geoWarnings(warn)).toHaveLength(2)
		} finally {
			vi.useRealTimers()
		}
	})

	it('keeps only text from an answer that is not a location', async () => {
		const odd = (() => ({
			country: 42,
			region: 'BY',
			city: { name: 'Munich' },
		})) as unknown as GeoResolver
		const none = (() => undefined) as unknown as GeoResolver
		const first = handlerWith({ geoResolver: odd })
		const second = handlerWith({ geoResolver: none })
		expect((await first.handler(req({ type: 'pageview', path: '/odd' }))).status).toBe(202)
		expect((await second.handler(req({ type: 'pageview', path: '/none' }))).status).toBe(202)

		expect(first.hits[0]).toMatchObject({ path: '/odd', region: 'BY' })
		expect(first.hits[0]?.country).toBeUndefined()
		expect(first.hits[0]?.city).toBeUndefined()
		expect(second.hits).toHaveLength(1)
		expect(second.hits[0]?.country).toBeUndefined()
	})
})
