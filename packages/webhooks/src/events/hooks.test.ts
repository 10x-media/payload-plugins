import { describe, expect, it, vi } from 'vitest'
import type { WebhookDispatchDeps } from './hooks'
import { makeAfterChange } from './hooks'

const makePayload = () => ({
	create: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
	update: vi.fn().mockResolvedValue({}),
	jobs: { queue: vi.fn().mockResolvedValue({}) },
	logger: { warn: vi.fn(), error: vi.fn() },
	find: vi.fn().mockResolvedValue({ docs: [] }),
})

const makeDeps = (overrides: Partial<WebhookDispatchDeps> = {}): WebhookDispatchDeps => ({
	collectionSlug: 'posts',
	config: {},
	operations: ['create', 'update', 'delete'],
	deliveriesSlug: 'webhook-deliveries',
	subscriptionsSlug: 'webhook-subscriptions',
	codeSubscriptions: [],
	mode: 'inline',
	timeoutMs: 1000,
	queue: 'default',
	...overrides,
})

const makeReq = (payload: ReturnType<typeof makePayload>) =>
	({ payload, context: {} }) as unknown as Parameters<ReturnType<typeof makeAfterChange>>[0]['req']

describe('dispatch (inline mode)', () => {
	it('records status=failed (not dead) when inline delivery fails', async () => {
		const payload = makePayload()
		const hook = makeAfterChange(
			makeDeps({
				mode: 'inline',
				codeSubscriptions: [{ id: 'sub-1', url: 'http://127.0.0.1:1', events: ['posts.created'] }],
			})
		)
		await hook({
			doc: { id: '1' },
			previousDoc: {},
			operation: 'create',
			req: makeReq(payload),
			collection: {} as never,
		})
		const updateCall = payload.update.mock.calls.find(
			(c) => c[0].data?.status !== undefined && c[0].data?.status !== 'pending'
		)
		expect(updateCall?.[0].data.status).toBe('failed')
	})

	it('skips delivery creation when transform returns undefined', async () => {
		const payload = makePayload()
		const hook = makeAfterChange(
			makeDeps({
				mode: 'inline',
				config: { transform: () => undefined },
				codeSubscriptions: [{ id: 'sub-1', url: 'http://127.0.0.1:1', events: ['posts.created'] }],
			})
		)
		await hook({
			doc: { id: '1' },
			previousDoc: {},
			operation: 'create',
			req: makeReq(payload),
			collection: {} as never,
		})
		expect(payload.create).not.toHaveBeenCalled()
	})
})

describe('resolveListening', () => {
	it('passes the triggering event to the DB query so the scan cap only applies to matching subscriptions', async () => {
		const payload = makePayload()
		payload.find.mockResolvedValue({ docs: [] })
		const hook = makeAfterChange(makeDeps())
		await hook({
			doc: { id: '1' },
			previousDoc: {},
			operation: 'create',
			req: makeReq(payload),
			collection: {} as never,
		})
		const findCall = payload.find.mock.calls[0]?.[0]
		expect(findCall?.where?.events).toBeDefined()
	})

	it('includes a sort in the DB query for deterministic scan ordering', async () => {
		const payload = makePayload()
		payload.find.mockResolvedValue({ docs: [] })
		const hook = makeAfterChange(makeDeps())
		await hook({
			doc: { id: '1' },
			previousDoc: {},
			operation: 'create',
			req: makeReq(payload),
			collection: {} as never,
		})
		const findCall = payload.find.mock.calls[0]?.[0]
		expect(findCall?.sort).toBeDefined()
	})
})
