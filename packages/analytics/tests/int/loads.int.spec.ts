import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

describeForDb('analytics loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [memoryAdapter()] }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('payload boots with the plugin loaded', () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('plugin does not corrupt the collections list', () => {
		expect(booted.payload.collections).toBeDefined()
	})
})
