import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { createEmit, getRuntime, getSSE, type SSERuntime, setRuntime } from './runtime'

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

const makeRuntime = (broker: EventBroker): SSERuntime => ({
	broker,
	collections: {},
	heartbeatMs: 15_000,
	presence: false,
	destroy: async () => {},
	emit: createEmit(broker),
})

describe('SSE runtime', () => {
	it('stores runtime on the payload instance via Symbol.for', () => {
		const payload = {} as Payload
		const broker = makeBroker()
		const runtime = makeRuntime(broker)
		setRuntime(payload, runtime)
		expect(getRuntime(payload)).toBe(runtime)
		expect(
			(payload as unknown as Record<symbol, unknown>)[Symbol.for('@10x-media/sse/runtime')]
		).toBe(runtime)
	})

	it('getSSE returns emit that publishes without throwing', () => {
		const payload = {} as Payload
		const broker = makeBroker()
		const runtime = makeRuntime(broker)
		setRuntime(payload, runtime)

		const { emit } = getSSE(payload)
		const event: RealtimeEvent = {
			id: '1',
			topic: 'posts',
			event: 'create',
			timestamp: Date.now(),
		}
		emit(event)
		expect(broker.published).toEqual([event])

		broker.publish = () => {
			throw new Error('boom')
		}
		expect(() => emit(event)).not.toThrow()
	})

	it('getSSE throws when runtime is missing', () => {
		const payload = {} as Payload
		expect(() => getSSE(payload)).toThrow(/sse/i)
	})
})
