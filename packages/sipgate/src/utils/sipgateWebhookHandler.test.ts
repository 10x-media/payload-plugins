import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sipgateWebhookHandler } from './sipgateWebhookHandler'

const kvStore = new Map<string, unknown>()

const mockPayload = {
	kv: {
		keys: async () => [...kvStore.keys()],
		get: async <T>(key: string) => (kvStore.get(key) as T | undefined) ?? null,
		set: async (key: string, value: unknown) => {
			kvStore.set(key, value)
		},
		delete: async (key: string) => {
			kvStore.delete(key)
		},
	},
	find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
	create: vi.fn(async ({ data }: { data: unknown }) => ({ id: '1', ...(data as object) })),
	update: vi.fn(async ({ data }: { data: unknown }) => data),
} as unknown as Payload

const makeReq = (body: string, method = 'POST'): PayloadRequest =>
	({
		method,
		text: async () => body,
		payload: mockPayload,
	}) as unknown as PayloadRequest

describe('sipgateWebhookHandler', () => {
	beforeEach(() => {
		kvStore.clear()
		vi.clearAllMocks()
	})

	it('returns XML onAnswer/onHangup from webhookUrl on newCall', async () => {
		const handler = sipgateWebhookHandler({
			callLogsSlug: 'call-logs',
			webhookUrl: 'https://app.example.com',
		})
		const res = await handler(
			makeReq('event=newCall&callId=c1&from=%2B49151&to=%2B4930&direction=in&origCallId=c1&xcid=x')
		)
		expect(res.status).toBe(200)
		const xml = await res.text()
		expect(xml).toContain('onAnswer="https://app.example.com/api/sipgate/webhooks"')
		expect(xml).toContain('onHangup="https://app.example.com/api/sipgate/webhooks"')
	})

	it('returns 204 on newCall when no webhookUrl and no env fallback', async () => {
		const handler = sipgateWebhookHandler({ callLogsSlug: 'call-logs' })
		const res = await handler(
			makeReq('event=newCall&callId=c1&from=%2B49151&to=%2B4930&direction=in&origCallId=c1&xcid=x')
		)
		expect(res.status).toBe(204)
	})

	it('stores the active call on newCall', async () => {
		const handler = sipgateWebhookHandler({
			callLogsSlug: 'call-logs',
			webhookUrl: 'https://app.example.com',
		})
		await handler(
			makeReq('event=newCall&callId=c1&from=%2B49151&to=%2B4930&direction=in&origCallId=c1&xcid=x')
		)
		expect(kvStore.size).toBeGreaterThan(0)
	})
})
