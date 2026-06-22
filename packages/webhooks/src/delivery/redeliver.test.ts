import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { RedeliverDeps } from './redeliver'
import { redeliverDelivery } from './redeliver'

const makeDeps = (overrides: Partial<RedeliverDeps> = {}): RedeliverDeps => ({
	deliveriesSlug: 'webhook-deliveries',
	subscriptionsSlug: 'webhook-subscriptions',
	codeSubscriptions: [],
	mode: 'inline',
	timeoutMs: 1000,
	queue: 'default',
	...overrides,
})

const makePayload = (overrides: Partial<ReturnType<typeof buildPayload>> = {}) => {
	const base = buildPayload()
	return { ...base, ...overrides }
}

function buildPayload() {
	return {
		findByID: vi.fn(),
		create: vi.fn().mockResolvedValue({ id: 'new-delivery' }),
		update: vi.fn().mockResolvedValue({}),
		find: vi.fn(),
		jobs: { queue: vi.fn().mockResolvedValue({}) },
		logger: { warn: vi.fn(), error: vi.fn() },
	}
}

const req = { context: {} } as unknown as PayloadRequest

describe('redeliverDelivery', () => {
	it('marks delivery dead when subscription is disabled', async () => {
		const payload = makePayload()
		payload.findByID.mockResolvedValue({
			id: 'orig',
			subscriptionId: 'sub-1',
			endpoint: 'https://example.com/hook',
			event: 'posts.created',
			payload: {},
		})
		// resolveSubscriptionById uses payload.find internally
		payload.find.mockResolvedValue({
			docs: [
				{
					id: 'sub-1',
					url: 'https://example.com/hook',
					events: ['posts.created'],
					enabled: false,
				},
			],
		})

		await redeliverDelivery({
			deps: makeDeps(),
			deliveryId: 'orig',
			payload: payload as unknown as Payload,
			req,
		})

		const updateCall = payload.update.mock.calls.find((c) => c[0].data?.status !== undefined)
		expect(updateCall?.[0].data.status).toBe('dead')
		expect(updateCall?.[0].data.error).toMatch(/disabled/)
	})
})
