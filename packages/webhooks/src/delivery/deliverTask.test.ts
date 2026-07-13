import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { buildDeliverTask } from './deliverTask'

const deps = {
	deliveriesSlug: 'webhook-deliveries',
	subscriptionsSlug: 'webhook-subscriptions',
	codeSubscriptions: [],
	timeoutMs: 5000,
	retries: 3,
}

const delivery = {
	id: 'del-1',
	subscriptionId: 'sub-1',
	event: 'posts.updated',
	payload: { data: { id: 'p1' } },
}

const makeReq = (subscriptionRow: Record<string, unknown> | null) => {
	const updates: Array<Record<string, unknown>> = []
	const payload = {
		findByID: vi.fn().mockResolvedValue(delivery),
		find: vi.fn().mockResolvedValue({ docs: subscriptionRow == null ? [] : [subscriptionRow] }),
		update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
			updates.push(args.data)
			return Promise.resolve({})
		}),
	} as unknown as Payload
	const req = { payload, context: {} } as unknown as PayloadRequest
	return { req, updates }
}

type Handler = (args: {
	input: unknown
	job: { totalTried?: number; id: string }
	req: PayloadRequest
}) => Promise<unknown>

describe('buildDeliverTask', () => {
	it('marks a queued delivery dead without sending when the subscription was disabled', async () => {
		const { req, updates } = makeReq({
			id: 'sub-1',
			url: 'https://receiver.test/hook',
			events: ['posts.updated'],
			enabled: false,
		})
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const task = buildDeliverTask(deps)
		await (task.handler as Handler)({
			input: { deliveryId: 'del-1' },
			job: { totalTried: 0, id: 'j1' },
			req,
		})

		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates).toEqual([{ status: 'dead', error: 'subscription disabled' }])
	})
})
