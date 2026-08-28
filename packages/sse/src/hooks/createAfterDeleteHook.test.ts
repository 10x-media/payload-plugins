import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it } from 'vitest'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { type SSERuntime, setRuntime } from '../plugin/runtime'
import { SSE_SKIP } from './createAfterChangeHook'
import { createAfterDeleteHook } from './createAfterDeleteHook'

const makeBroker = (): EventBroker & { published: RealtimeEvent[] } => {
	const published: RealtimeEvent[] = []
	return {
		published,
		publish: (event) => {
			published.push(event)
		},
		subscribe: () => () => {},
		destroy: async () => {},
	}
}

const makePayload = (): Payload => ({}) as Payload

const makeRuntime = (broker: EventBroker): SSERuntime => ({
	broker,
	collections: { posts: { thinEvents: true, events: ['create', 'update', 'delete'] } },
	heartbeatMs: 15_000,
	destroy: async () => {},
	emit: (event) => {
		try {
			broker.publish(event)
		} catch {
			// emit must never throw
		}
	},
})

describe('createAfterDeleteHook', () => {
	let broker: ReturnType<typeof makeBroker>
	let payload: Payload

	beforeEach(() => {
		broker = makeBroker()
		payload = makePayload()
		setRuntime(payload, makeRuntime(broker))
	})

	it('publishes thin delete events to list and doc topics', async () => {
		const hook = createAfterDeleteHook({ collection: 'posts', events: ['delete'] })
		const doc = { id: 'gone', title: 'Bye' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		const result = await hook({
			doc,
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(result).toBe(doc)
		expect(broker.published).toHaveLength(2)
		expect(broker.published.map((e) => e.topic).sort()).toEqual(['posts', 'posts:gone'])
		for (const event of broker.published) {
			expect(event.event).toBe('delete')
			expect(event.operation).toBe('delete')
			expect(event.collection).toBe('posts')
			expect(event.docId).toBe('gone')
			expect(event.data).toBeUndefined()
		}
	})

	it('skips when delete is not in events', async () => {
		const hook = createAfterDeleteHook({ collection: 'posts', events: ['create', 'update'] })
		const doc = { id: '1' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		await hook({
			doc,
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(broker.published).toHaveLength(0)
	})

	it('skips when SSE_SKIP is set', async () => {
		const hook = createAfterDeleteHook({ collection: 'posts', events: ['delete'] })
		const doc = { id: '1' }
		const req = { payload, context: { [SSE_SKIP]: true } } as unknown as PayloadRequest

		await hook({
			doc,
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(broker.published).toHaveLength(0)
	})

	it('returns doc when publish throws', async () => {
		broker.publish = () => {
			throw new Error('boom')
		}
		const hook = createAfterDeleteHook({ collection: 'posts', events: ['delete'] })
		const doc = { id: '1' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		const result = await hook({
			doc,
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(result).toBe(doc)
	})
})
