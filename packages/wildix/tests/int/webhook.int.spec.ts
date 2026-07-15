import { createHmac } from 'node:crypto'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { wildix } from '../../src/index'
import { wildixWebhookHandler } from '../../src/utils/wildixWebhookHandler'

const sign = (body: string, secret: string) =>
	createHmac('sha256', secret).update(body).digest('hex')

type CallHandlerOptions = {
	payload: BootedPayload['payload']
	handlerOptions: { callLogsSlug: string; webhookSecret?: string }
	body: string
	signature?: string | null
}

const callHandler = async ({ payload, handlerOptions, body, signature }: CallHandlerOptions) => {
	const handler = wildixWebhookHandler(handlerOptions)
	const req = {
		method: 'POST',
		payload,
		text: async () => body,
		headers: {
			get: (name: string) => (name.toLowerCase() === 'x-signature' ? (signature ?? null) : null),
		},
	}
	return (handler as unknown as (r: unknown) => Promise<Response>)(req)
}

describeForDb('wildixWebhookHandler', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: wildix({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('rejects a request with an invalid signature and does not touch the store', async () => {
		const { payload } = booted
		const body = JSON.stringify({ event: 'call:start', data: { callId: 'sig-1' } })

		const response = await callHandler({
			payload,
			handlerOptions: { callLogsSlug: 'call-logs', webhookSecret: 'shh' },
			body,
			signature: 'not-the-right-signature',
		})

		expect(response.status).toBe(401)
	})

	it('tracks call:start then writes a completed call log with a duration on call:completed', async () => {
		const { payload } = booted
		const secret = 'shh'
		const callLogsSlug = 'call-logs'
		const handlerOptions = { callLogsSlug, webhookSecret: secret }

		const startBody = JSON.stringify({
			event: 'call:start',
			data: {
				sipCallId: 'call-42',
				from: '+491111',
				to: '+492222',
				direction: 'inbound',
				userId: 'w0',
			},
		})
		const startResponse = await callHandler({
			payload,
			handlerOptions,
			body: startBody,
			signature: sign(startBody, secret),
		})
		expect(startResponse.status).toBe(204)

		const updateBody = JSON.stringify({ event: 'call:update', data: { sipCallId: 'call-42' } })
		const updateResponse = await callHandler({
			payload,
			handlerOptions,
			body: updateBody,
			signature: sign(updateBody, secret),
		})
		expect(updateResponse.status).toBe(204)

		const completedBody = JSON.stringify({
			event: 'call:completed',
			data: { sipCallId: 'call-42' },
		})
		const completedResponse = await callHandler({
			payload,
			handlerOptions,
			body: completedBody,
			signature: sign(completedBody, secret),
		})
		expect(completedResponse.status).toBe(204)

		const logs = await payload.find({
			collection: callLogsSlug,
			where: { callId: { equals: 'call-42' } },
			overrideAccess: true,
		})
		expect(logs.totalDocs).toBe(1)
		expect(logs.docs[0]).toMatchObject({
			callId: 'call-42',
			callType: 'in',
			callStatus: 'completed',
			fromNumber: '+491111',
			toNumber: '+492222',
		})
	})

	it('marks a call missed when it completes without ever being answered', async () => {
		const { payload } = booted
		const secret = 'shh'
		const callLogsSlug = 'call-logs'
		const handlerOptions = { callLogsSlug, webhookSecret: secret }

		const startBody = JSON.stringify({
			event: 'call:start',
			data: { sipCallId: 'call-missed-1', from: '+493333', to: '+494444', direction: 'inbound' },
		})
		await callHandler({
			payload,
			handlerOptions,
			body: startBody,
			signature: sign(startBody, secret),
		})

		const completedBody = JSON.stringify({
			event: 'call:completed',
			data: { sipCallId: 'call-missed-1' },
		})
		await callHandler({
			payload,
			handlerOptions,
			body: completedBody,
			signature: sign(completedBody, secret),
		})

		const logs = await payload.find({
			collection: callLogsSlug,
			where: { callId: { equals: 'call-missed-1' } },
			overrideAccess: true,
		})
		expect(logs.docs[0]).toMatchObject({ callStatus: 'missed', callDuration: 0 })
	})
})
