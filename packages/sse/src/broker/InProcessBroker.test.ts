import { describe, expect, it, vi } from 'vitest'

import { InProcessBroker } from './InProcessBroker'
import type { RealtimeEvent } from './types'

const makeEvent = (topic: string, overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
	id: 'evt-1',
	topic,
	event: 'update',
	timestamp: 1,
	...overrides,
})

describe('InProcessBroker', () => {
	it('publishes only to subscribers of the event topic', () => {
		const broker = new InProcessBroker()
		const posts = vi.fn()
		const pages = vi.fn()
		broker.subscribe('posts', posts)
		broker.subscribe('pages', pages)

		const event = makeEvent('posts')
		broker.publish(event)

		expect(posts).toHaveBeenCalledOnce()
		expect(posts).toHaveBeenCalledWith(event)
		expect(pages).not.toHaveBeenCalled()
	})

	it('stops delivery after unsubscribe', () => {
		const broker = new InProcessBroker()
		const cb = vi.fn()
		const unsubscribe = broker.subscribe('posts', cb)

		unsubscribe()
		broker.publish(makeEvent('posts'))

		expect(cb).not.toHaveBeenCalled()
	})

	it('does not throw to the publisher when a subscriber throws, and still delivers to others', () => {
		const broker = new InProcessBroker()
		const second = vi.fn()
		broker.subscribe('posts', () => {
			throw new Error('listener boom')
		})
		broker.subscribe('posts', second)

		const event = makeEvent('posts')
		expect(() => broker.publish(event)).not.toThrow()
		expect(second).toHaveBeenCalledOnce()
		expect(second).toHaveBeenCalledWith(event)
	})

	it('destroy drops all listeners; pre-destroy subscribers miss post-destroy publishes', async () => {
		const broker = new InProcessBroker()
		const before = vi.fn()
		broker.subscribe('posts', before)

		await broker.destroy()

		broker.publish(makeEvent('posts'))
		expect(before).not.toHaveBeenCalled()

		const after = vi.fn()
		broker.subscribe('posts', after)
		const event = makeEvent('posts', { id: 'evt-2' })
		broker.publish(event)
		expect(after).toHaveBeenCalledOnce()
		expect(after).toHaveBeenCalledWith(event)
	})
})
