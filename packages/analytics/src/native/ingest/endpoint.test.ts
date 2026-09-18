import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../goals/types'
import { noopResolver } from '../geo/geoResolver'
import { makeIngestHandler } from './endpoint'
import type { StoredEvent } from './normalizeEvent'
import type { WriteBuffer } from './writeBuffer'

/** A visitor's agent: the handler drops anything the bot filter recognizes before reading a body. */
const VISITOR_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** A real Request, because the handler reads the body stream rather than `req.json()`. */
const rawReq = (body: BodyInit, contentType = 'application/json'): PayloadRequest =>
	Object.assign(
		new Request('http://localhost/api/analytics/ingest', {
			method: 'POST',
			body,
			headers: {
				'content-type': contentType,
				host: 'site.example',
				'user-agent': VISITOR_UA,
			},
		}),
		{ payload: { kv: { get: async () => ({ salt: 'salt' }), set: async () => undefined } } }
	) as unknown as PayloadRequest

const req = (body: unknown): PayloadRequest => rawReq(JSON.stringify(body))

/** Captures what the handler would flush without touching a database. */
const capture = (): { buffer: WriteBuffer<StoredEvent>; events: StoredEvent[] } => {
	const events: StoredEvent[] = []
	const buffer = {
		add: (event: StoredEvent) => events.push(event),
		flush: async () => undefined,
	} as unknown as WriteBuffer<StoredEvent>
	return { buffer, events }
}

const handlerWith = (goals?: Goal[]) => {
	const { buffer, events } = capture()
	const handler = makeIngestHandler({
		geoResolver: noopResolver,
		getBuffer: () => buffer,
		resolvers: goals ? { goals: async () => goals } : {},
	})
	return { handler, events }
}

describe('makeIngestHandler validation', () => {
	it('returns 400 for an invalid body', async () => {
		const handler = makeIngestHandler({ geoResolver: noopResolver })
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
		const { handler, events } = handlerWith()
		const oversized = JSON.stringify({
			type: 'pageview',
			path: '/x',
			hostname: 'h',
			props: { note: 'x'.repeat(70_000) },
		})
		expect((await handler(rawReq(oversized))).status).toBe(413)
		expect(events).toEqual([])
	})

	it('reads a beacon body, which is sent as text/plain', async () => {
		const { handler, events } = handlerWith()
		const body = JSON.stringify({ type: 'pageview', path: '/beacon', hostname: 'h' })
		expect((await handler(rawReq(body, 'text/plain;charset=UTF-8'))).status).toBe(202)
		expect(events[0]?.path).toBe('/beacon')
	})

	it('accepts a goal event carrying a name', async () => {
		const { handler, events } = handlerWith()
		const res = await handler(req({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h' }))
		expect(res.status).toBe(202)
		expect(events[0]?.type).toBe('goal')
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
		const { handler, events } = handlerWith()
		expect((await handler(req({ type: 'nope', path: '/p', hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: '/p' }))).status).toBe(202)
		expect(events[0]?.hostname).toBe('site.example')
	})

	it('400s a non-string path, hostname, or name rather than letting it reach matching', async () => {
		const { handler } = handlerWith([
			{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
		])
		expect((await handler(req({ type: 'pageview', path: {}, hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: ['/p'], hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: '/p', hostname: 7 }))).status).toBe(400)
		expect((await handler(req({ type: 'goal', name: {}, path: '/p', hostname: 'h' }))).status).toBe(
			400
		)
	})

	it('accepts a pageview with no name', async () => {
		const { handler, events } = handlerWith()
		expect((await handler(req({ type: 'pageview', path: '/p', hostname: 'h' }))).status).toBe(202)
		expect(events[0]?.name).toBeUndefined()
	})

	it('accepts the event rather than 400ing when optional fields are junk', async () => {
		const { handler, events } = handlerWith()
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
		expect(events[0]?.value).toBeUndefined()
		expect(events[0]?.currency).toBeUndefined()
		expect(events[0]?.scrollDepth).toBeUndefined()
		expect(events[0]?.props).toBeUndefined()
	})

	it('carries value, currency, scrollDepth and props through to the stored event', async () => {
		const { handler, events } = handlerWith()
		await handler(
			req({
				type: 'goal',
				name: 'purchase',
				path: '/p',
				hostname: 'h',
				value: 30,
				currency: 'USD',
				scrollDepth: 55,
				props: { plan: 'pro' },
			})
		)
		expect(events[0]).toMatchObject({
			value: 30,
			currency: 'USD',
			scrollDepth: 55,
			props: { plan: 'pro' },
		})
	})
})

describe('makeIngestHandler goal matching', () => {
	const goals: Goal[] = [
		{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' }, value: { prop: 'total' } },
		{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
	]

	it('stamps matched goals on the event before it is buffered', async () => {
		const { handler, events } = handlerWith(goals)
		await handler(req({ type: 'pageview', path: '/thank-you', hostname: 'h' }))
		expect(events[0]?.goals).toEqual([{ slug: 'thanks', value: 0 }])
	})

	it('resolves a goal value from a prop', async () => {
		const { handler, events } = handlerWith(goals)
		await handler(
			req({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', props: { total: 25 } })
		)
		expect(events[0]?.goals).toEqual([{ slug: 'purchase', value: 25 }])
	})

	it('resolves goals with the same scope the event is stamped with', async () => {
		const { buffer, events } = capture()
		const resolveGoals = vi.fn(async (_req: PayloadRequest, _scope?: string | null) => goals)
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			getBuffer: () => buffer,
			resolvers: { scope: async () => 't1', goals: resolveGoals },
		})
		await handler(req({ type: 'pageview', path: '/thank-you', hostname: 'h' }))
		expect(resolveGoals.mock.calls[0]?.[1]).toBe('t1')
		expect(events[0]?.scope).toBe('t1')
	})

	it('ingests normally when no goals resolver is configured', async () => {
		const { handler, events } = handlerWith()
		expect(
			(await handler(req({ type: 'pageview', path: '/thank-you', hostname: 'h' }))).status
		).toBe(202)
		expect(events[0]?.goals).toBeUndefined()
	})
})

describe('makeIngestHandler attribution', () => {
	const withHost = (body: unknown, headers: Record<string, string>): PayloadRequest =>
		Object.assign(
			new Request('http://localhost/api/analytics/ingest', {
				method: 'POST',
				body: JSON.stringify(body),
				headers: { 'content-type': 'application/json', 'user-agent': VISITOR_UA, ...headers },
			}),
			{ payload: { kv: { get: async () => ({ salt: 'salt' }), set: async () => undefined } } }
		) as unknown as PayloadRequest

	const handlerWithAttribution = (
		attribution: Parameters<typeof makeIngestHandler>[0]['attribution'],
		resolvers: Parameters<typeof makeIngestHandler>[0]['resolvers'] = {}
	) => {
		const { buffer, events } = capture()
		return {
			events,
			handler: makeIngestHandler({
				geoResolver: noopResolver,
				getBuffer: () => buffer,
				resolvers,
				attribution,
			}),
		}
	}

	const pageview = { type: 'pageview', path: '/p', hostname: 'evil.example' }

	it('stores the request host and ignores the body claim and Origin', async () => {
		const { handler, events } = handlerWithAttribution({})
		const res = await handler(
			withHost(pageview, { host: 'a.example:3000', origin: 'https://other.example' })
		)
		expect(res.status).toBe(202)
		expect(events[0]?.hostname).toBe('a.example')
	})

	it('answers a drop exactly as it answers an accepted event', async () => {
		const { handler, events } = handlerWithAttribution({})
		const kept = await handler(withHost(pageview, { host: 'a.example' }))
		const dropped = await handler(withHost(pageview, {}))
		expect(dropped.status).toBe(kept.status)
		expect(await dropped.text()).toBe(await kept.text())
		expect([...dropped.headers].sort()).toEqual([...kept.headers].sort())
		expect(events).toHaveLength(1)
	})

	it('drops an event whose request resolves no scope on a scoped install', async () => {
		const { handler, events } = handlerWithAttribution(
			{},
			{
				scope: async (req) => {
					const host = req.headers.get('host') ?? ''
					return host.includes('.') ? (host.split('.')[0] ?? null) : null
				},
			}
		)
		await handler(withHost(pageview, { host: 'unknown' }))
		await handler(withHost(pageview, { host: 't1.example' }))
		expect(events.map((event) => [event.hostname, event.scope])).toEqual([['t1.example', 't1']])
	})

	it('keeps a platform hostname under the null scope', async () => {
		const { handler, events } = handlerWithAttribution(
			{ platformHostnames: new Set(['platform.example']) },
			{ scope: async () => null }
		)
		await handler(withHost(pageview, { host: 'platform.example' }))
		await handler(withHost(pageview, { host: 'tenant.example' }))
		expect(events.map((event) => [event.hostname, event.scope])).toEqual([['platform.example', '']])
	})

	it('reads x-forwarded-host only once a proxy hop is trusted', async () => {
		const forwarded = { host: 'a.example', 'x-forwarded-host': 'b.example' }
		const ignored = handlerWithAttribution({ trustedProxyHops: 0 })
		await ignored.handler(withHost(pageview, forwarded))
		expect(ignored.events[0]?.hostname).toBe('a.example')

		const trusted = handlerWithAttribution({ trustedProxyHops: 1 })
		await trusted.handler(withHost(pageview, forwarded))
		expect(trusted.events[0]?.hostname).toBe('b.example')
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
	): PayloadRequest =>
		Object.assign(
			new Request('http://localhost/api/analytics/ingest', {
				method: 'POST',
				body: JSON.stringify({ type: 'pageview', path: '/p' }),
				headers: { 'content-type': 'application/json', 'user-agent': VISITOR_UA, ...headers },
			}),
			{
				payload: {
					kv: { get: async () => ({ salt: 'salt' }), set: async () => undefined },
					logger: { warn },
				},
			}
		) as unknown as PayloadRequest

	it('warns once for a refused hostname and stays silent on every later drop', async () => {
		const warn = vi.fn()
		const { buffer } = capture()
		const handler = makeIngestHandler({ geoResolver: noopResolver, getBuffer: () => buffer })
		await handler(withLogger({}, warn))
		await handler(withLogger({}, warn))
		await handler(withLogger({ host: 'a.example' }, warn))
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/hostname option/)
	})

	it('warns once for an unresolved scope, naming scopeResolver and platformHostnames', async () => {
		const warn = vi.fn()
		const { buffer } = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			getBuffer: () => buffer,
			resolvers: { scope: async () => null },
		})
		await handler(withLogger({ host: 'a.example' }, warn))
		await handler(withLogger({ host: 'b.example' }, warn))
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/scopeResolver/)
		expect(warn.mock.calls[0]?.[0]).toMatch(/platformHostnames/)
	})

	it('keeps each reason on its own budget', async () => {
		const warn = vi.fn()
		const { buffer } = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			getBuffer: () => buffer,
			resolvers: { scope: async () => null },
		})
		await handler(withLogger({}, warn))
		await handler(withLogger({ host: 'a.example' }, warn))
		expect(warn).toHaveBeenCalledTimes(2)
	})

	// A crawler is expected traffic, not a misconfiguration: it earns no line at all.
	it('says nothing at all about a bot', async () => {
		const warn = vi.fn()
		const { buffer, events } = capture()
		const handler = makeIngestHandler({ geoResolver: noopResolver, getBuffer: () => buffer })
		const res = await handler(
			withLogger({ host: 'a.example', 'user-agent': 'Googlebot/2.1' }, warn)
		)
		expect(res.status).toBe(202)
		expect(await res.json()).toEqual({ ok: true })
		expect(events).toEqual([])
		expect(warn).not.toHaveBeenCalled()
	})

	// A stripped agent zeroes an install's numbers, so it is the one drop worth a line.
	it('warns once for a beacon with no user agent and stays silent after', async () => {
		const warn = vi.fn()
		const { buffer, events } = capture()
		const handler = makeIngestHandler({ geoResolver: noopResolver, getBuffer: () => buffer })
		const res = await handler(withLogger({ host: 'a.example', 'user-agent': '' }, warn))
		await handler(withLogger({ host: 'a.example', 'user-agent': '' }, warn))
		expect(res.status).toBe(202)
		expect(events).toEqual([])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/no user agent/)
	})

	it('keeps the event and warns once when the bot filter throws', async () => {
		const warn = vi.fn()
		const { buffer, events } = capture()
		const handler = makeIngestHandler({
			geoResolver: noopResolver,
			getBuffer: () => buffer,
			filterBots: () => {
				throw new Error('boom')
			},
		})
		const res = await handler(withLogger({ host: 'a.example' }, warn))
		await handler(withLogger({ host: 'a.example' }, warn))
		expect(res.status).toBe(202)
		expect(events).toHaveLength(2)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/filterBots/)
	})
})
