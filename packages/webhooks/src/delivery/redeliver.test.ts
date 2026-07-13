import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBHOOK_DELIVER_TASK } from '../constants'
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
	const creates: Array<Record<string, unknown>> = []
	const payload = {
		findByID: vi.fn().mockResolvedValue(original),
		find: vi.fn().mockResolvedValue({ docs: subscriptionRow == null ? [] : [subscriptionRow] }),
		create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
			creates.push(args.data)
			return Promise.resolve({ id: 'del-2' })
		}),
		update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
			updates.push(args.data)
			return Promise.resolve({})
		}),
		jobs: { queue: vi.fn() },
	} as unknown as Payload
	return { payload, updates, creates }
}

const req = { context: {} } as unknown as PayloadRequest

describe('redeliverDelivery', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('marks the new delivery dead without sending when the subscription is disabled', async () => {
		const { payload, updates, creates } = makePayload({
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
		expect(creates[0]?.endpoint).toBe('https://receiver.test/hook')
	})

	it('stores the live url on the dead row when a disabled subscription url differs from the original endpoint', async () => {
		const { payload, updates, creates } = makePayload({
			id: 'sub-1',
			url: 'https://receiver.test/new-hook',
			events: ['posts.updated'],
			enabled: false,
		})
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates).toEqual([{ status: 'dead', error: 'subscription disabled' }])
		expect(creates[0]?.endpoint).toBe('https://receiver.test/new-hook')
		expect(creates[0]?.endpoint).not.toBe(original.endpoint)
	})

	it('marks the new delivery dead when the subscription is missing, falling back to the stored endpoint', async () => {
		const { payload, updates, creates } = makePayload(null)
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates).toEqual([{ status: 'dead', error: 'subscription not found' }])
		expect(creates[0]?.endpoint).toBe(original.endpoint)
	})

	it('stores the live subscription url on the new row when it differs from the original endpoint (inline mode)', async () => {
		const { payload, creates } = makePayload({
			id: 'sub-1',
			url: 'https://receiver.test/new-hook',
			events: ['posts.updated'],
			enabled: true,
		})
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: async () => '',
			})
		)

		const result = await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(result.id).toBe('del-2')
		expect(creates[0]?.endpoint).toBe('https://receiver.test/new-hook')
		expect(creates[0]?.endpoint).not.toBe(original.endpoint)
		vi.unstubAllGlobals()
	})

	it('stores the live subscription url on the new row when it differs from the original endpoint (queue mode)', async () => {
		const { payload, creates } = makePayload({
			id: 'sub-1',
			url: 'https://receiver.test/new-hook',
			events: ['posts.updated'],
			enabled: true,
		})

		const result = await redeliverDelivery({
			deps: { ...deps, mode: 'queue' },
			deliveryId: 'del-1',
			payload,
			req,
		})

		expect(result.id).toBe('del-2')
		expect(creates[0]?.endpoint).toBe('https://receiver.test/new-hook')
		expect(creates[0]?.endpoint).not.toBe(original.endpoint)
		expect(payload.jobs.queue as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
			task: WEBHOOK_DELIVER_TASK,
			input: { deliveryId: 'del-2' },
			queue: deps.queue,
		})
	})
})
