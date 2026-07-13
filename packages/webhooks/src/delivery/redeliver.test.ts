import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedeliverDeps } from './redeliver'
import { redeliverDelivery } from './redeliver'

const deps: RedeliverDeps = {
	deliveriesSlug: 'webhook-deliveries',
	subscriptionsSlug: 'webhook-subscriptions',
	codeSubscriptions: [],
	mode: 'inline',
	timeoutMs: 5000,
	queue: 'webhooks',
}

const original = {
	id: 'del-1',
	subscriptionId: 'sub-1',
	endpoint: 'https://receiver.test/hook',
	event: 'posts.updated',
	payload: { data: { id: 'p1' } },
}

const makePayload = (subscriptionRow: Record<string, unknown> | null) => {
	const updates: Array<Record<string, unknown>> = []
	const payload = {
		findByID: vi.fn().mockResolvedValue(original),
		find: vi.fn().mockResolvedValue({ docs: subscriptionRow == null ? [] : [subscriptionRow] }),
		create: vi.fn().mockResolvedValue({ id: 'del-2' }),
		update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
			updates.push(args.data)
			return Promise.resolve({})
		}),
		jobs: { queue: vi.fn() },
	} as unknown as Payload
	return { payload, updates }
}

const req = { context: {} } as unknown as PayloadRequest

describe('redeliverDelivery', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('marks the new delivery dead without sending when the subscription is disabled', async () => {
		const { payload, updates } = makePayload({
			id: 'sub-1',
			url: 'https://receiver.test/hook',
			events: ['posts.updated'],
			enabled: false,
		})
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(result.id).toBe('del-2')
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates).toEqual([{ status: 'dead', error: 'subscription disabled' }])
	})

	it('marks the new delivery dead when the subscription is missing', async () => {
		const { payload, updates } = makePayload(null)
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates).toEqual([{ status: 'dead', error: 'subscription not found' }])
	})
})
