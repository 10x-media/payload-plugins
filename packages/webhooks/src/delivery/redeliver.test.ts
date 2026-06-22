import { createServer, type Server } from 'node:http'
import type { Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RedeliverDeps } from './redeliver'
import { redeliverDelivery } from './redeliver'

let server: Server
let serverUrl: string
let lastRequestUrl: string | undefined

beforeAll(async () => {
	server = createServer((req, res) => {
		lastRequestUrl = req.url ?? '/'
		res.writeHead(200)
		res.end('ok')
	})
	await new Promise<void>((resolve) => server.listen(0, resolve))
	const addr = server.address()
	if (!addr || typeof addr === 'string') throw new Error('no port')
	serverUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

const makeDeps = (overrides: Partial<RedeliverDeps> = {}): RedeliverDeps => ({
	deliveriesSlug: 'webhook-deliveries',
	subscriptionsSlug: 'webhook-subscriptions',
	codeSubscriptions: [],
	mode: 'inline',
	timeoutMs: 1000,
	queue: 'default',
	...overrides,
})

const makePayload = () => ({
	findByID: vi.fn(),
	create: vi.fn().mockResolvedValue({ id: 'new-delivery' }),
	update: vi.fn().mockResolvedValue({}),
	find: vi.fn(),
	jobs: { queue: vi.fn().mockResolvedValue({}) },
	logger: { warn: vi.fn(), error: vi.fn() },
})

const req = { context: {} } as unknown as PayloadRequest

describe('redeliverDelivery', () => {
	it('marks delivery dead when subscription is disabled', async () => {
		const payload = makePayload()
		payload.findByID.mockResolvedValue({
			id: 'orig',
			subscriptionId: 'sub-1',
			endpoint: `${serverUrl}/hook`,
			event: 'posts.created',
			payload: {},
		})
		payload.find.mockResolvedValue({
			docs: [{ id: 'sub-1', url: `${serverUrl}/hook`, events: ['posts.created'], enabled: false }],
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

	it('sends to the stored endpoint, not the live subscription URL', async () => {
		const storedPath = '/original-path'
		const livePath = '/changed-path'
		const payload = makePayload()
		payload.findByID.mockResolvedValue({
			id: 'orig',
			subscriptionId: 'sub-1',
			endpoint: `${serverUrl}${storedPath}`,
			event: 'posts.created',
			payload: { id: 'd', event: 'posts.created', data: {} },
		})
		payload.find.mockResolvedValue({
			docs: [
				{
					id: 'sub-1',
					url: `${serverUrl}${livePath}`,
					events: ['posts.created'],
					enabled: true,
				},
			],
		})
		lastRequestUrl = undefined

		await redeliverDelivery({
			deps: makeDeps(),
			deliveryId: 'orig',
			payload: payload as unknown as Payload,
			req,
		})

		expect(lastRequestUrl).toBe(storedPath)
	})
})
