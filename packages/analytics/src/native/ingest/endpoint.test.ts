import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../goals/types'
import { noopResolver } from '../geo/geoResolver'
import { makeIngestHandler } from './endpoint'
import type { StoredEvent } from './normalizeEvent'
import type { WriteBuffer } from './writeBuffer'

const req = (body: unknown): PayloadRequest =>
	({
		headers: new Headers({ 'content-type': 'application/json' }),
		json: async () => body,
		payload: { kv: { get: async () => ({ salt: 'salt' }), set: async () => undefined } },
	}) as unknown as PayloadRequest

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
	const handler = makeIngestHandler(
		noopResolver,
		() => buffer,
		goals ? { goals: async () => goals } : {}
	)
	return { handler, events }
}

describe('makeIngestHandler validation', () => {
	it('returns 400 for an invalid body', async () => {
		const handler = makeIngestHandler(noopResolver)
		const res = await handler({
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({}),
		} as never)
		expect(res.status).toBe(400)
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

	it('400s an unknown type, a missing path, and a missing hostname', async () => {
		const { handler } = handlerWith()
		expect((await handler(req({ type: 'nope', path: '/p', hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', hostname: 'h' }))).status).toBe(400)
		expect((await handler(req({ type: 'pageview', path: '/p' }))).status).toBe(400)
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
		const handler = makeIngestHandler(noopResolver, () => buffer, {
			scope: async () => 't1',
			goals: resolveGoals,
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
