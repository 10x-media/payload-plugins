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

	/** A replay goes out under its own `webhook-id`, and the body's `id` is that same string. */
	it('restamps the replayed body with the new delivery message id', async () => {
		const { payload, updates } = makePayload(null)

		await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(updates[0]).toEqual({ payload: { data: { id: 'p1' }, id: 'msg_del-2' } })
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
		// The caller shows this to the operator, so a refused replay must not read as a queued one.
		expect(result.status).toBe('dead')
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates.slice(1)).toEqual([{ status: 'dead', error: 'subscription disabled' }])
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
		expect(updates.slice(1)).toEqual([{ status: 'dead', error: 'subscription disabled' }])
		expect(creates[0]?.endpoint).toBe('https://receiver.test/new-hook')
		expect(creates[0]?.endpoint).not.toBe(original.endpoint)
	})

	/** "Queued" is the wrong thing to tell an operator whose replay was sent and rejected. */
	it('reports whether an inline replay was accepted or rejected by the receiver', async () => {
		const row = { id: 'sub-1', url: 'https://receiver.test/hook', events: [], enabled: true }
		const answer = (status: number) =>
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => '' })
			)

		answer(200)
		const accepted = await redeliverDelivery({
			deps,
			deliveryId: 'del-1',
			payload: makePayload(row).payload,
			req,
		})
		expect(accepted.status).toBe('success')

		answer(500)
		const rejected = await redeliverDelivery({
			deps,
			deliveryId: 'del-1',
			payload: makePayload(row).payload,
			req,
		})
		expect(rejected.status).toBe('dead')
		vi.unstubAllGlobals()
	})

	/** The task would refuse it anyway when it ran; saying so now beats reporting it as queued. */
	it('refuses a replay that is going nowhere before queuing it', async () => {
		const { payload, updates } = makePayload({
			id: 'sub-1',
			url: 'https://receiver.test/hook',
			events: [],
			enabled: false,
		})

		const result = await redeliverDelivery({
			deps: { ...deps, mode: 'queue' },
			deliveryId: 'del-1',
			payload,
			req,
		})

		expect(result.status).toBe('dead')
		expect(payload.jobs.queue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
		expect(updates.slice(1)).toEqual([{ status: 'dead', error: 'subscription disabled' }])
	})

	it('marks the new delivery dead when the subscription is missing, falling back to the stored endpoint', async () => {
		const { payload, updates, creates } = makePayload(null)
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		await redeliverDelivery({ deps, deliveryId: 'del-1', payload, req })

		expect(fetchSpy).not.toHaveBeenCalled()
		expect(updates.slice(1)).toEqual([{ status: 'dead', error: 'subscription not found' }])
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
		expect(result.status).toBe('pending')
		expect(payload.jobs.queue as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
			task: WEBHOOK_DELIVER_TASK,
			input: { deliveryId: 'del-2' },
			queue: deps.queue,
			// The caller's request, so the job shares the transaction the new row was created in.
			req,
		})
	})
})
