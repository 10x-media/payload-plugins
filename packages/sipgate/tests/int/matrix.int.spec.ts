import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { sipgate } from '../../src/index'

describeForDb('sipgate cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: sipgate({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})
})
