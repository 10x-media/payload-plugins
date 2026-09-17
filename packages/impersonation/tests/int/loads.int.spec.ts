import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { impersonation } from '../../src/index'

describeForDb('impersonation loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('payload boots with the plugin loaded', () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('registers the impersonation-sessions collection', () => {
		expect(booted.payload.collections['impersonation-sessions']).toBeDefined()
	})
})
