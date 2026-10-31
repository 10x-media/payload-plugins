import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { feedbackRecorder } from '../../src/index'

describeForDb('feedbackRecorder cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: feedbackRecorder({ url: 'https://tenx.test', apiKey: 'rec_matrix-key' }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db} with the recorder configured`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
		expect(
			booted.payload.config.endpoints.some(
				(endpoint) => endpoint.path === '/feedback-recorder/clips'
			)
		).toBe(true)
	})
})
