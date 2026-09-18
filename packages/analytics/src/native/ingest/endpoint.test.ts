import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../goals/types'
import { noopResolver } from '../geo/geoResolver'
import { makeIngestHandler } from './endpoint'
import type { StoredEvent } from './normalizeEvent'
import type { WriteBuffer } from './writeBuffer'

/** A real Request, because the handler reads the body stream rather than `req.json()`. */
const rawReq = (body: BodyInit, contentType = 'application/json'): PayloadRequest =>
	Object.assign(
		new Request('http://localhost/api/analytics/ingest', {
			method: 'POST',
			body,
			headers: { 'content-type': contentType, host: 'site.example' },
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
				headers: { 'content-type': 'application/json', ...headers },
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

	it('pays for neither the timezone nor the goals resolver on a drop', async () => {
		const timezone = vi.fn(async () => 'Europe/Berlin')
		const goals = vi.fn(async () => [])
		const { handler } = handlerWithAttribution({}, { timezone, goals })
		await handler(withHost(pageview, {}))
		expect(timezone).not.toHaveBeenCalled()
		expect(goals).not.toHaveBeenCalled()
	})
})
