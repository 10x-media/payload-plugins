import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { aroundNow } from './nativeHelpers'

describeForDb('the requests native hands host resolvers', {}, (db) => {
	let booted: BootedPayload
	const zoneRequests: PayloadRequest[] = []
	const currencyRequests: PayloadRequest[] = []
	const adapter = native()

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				reportingTimezone: ({ req }) => {
					zoneRequests.push(req)
					return 'UTC'
				},
				revenue: {
					currency: ({ req }) => {
						currencyRequests.push(req)
						return 'EUR'
					},
				},
			}),
			db,
		})
	}, 120_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`gives each background call a request of its own, never one kept for the process, on ${db}`, async () => {
		const ctx = { payload: booted.payload }
		for (let read = 0; read < 3; read++) {
			await adapter.query({ metrics: ['pageviews', 'revenue'], dateRange: aroundNow() }, ctx)
		}
		expect(zoneRequests.length).toBeGreaterThanOrEqual(3)
		expect(currencyRequests.length).toBeGreaterThanOrEqual(3)
		expect(new Set(zoneRequests).size).toBe(zoneRequests.length)
		expect(new Set(currencyRequests).size).toBe(currencyRequests.length)
	})
})
