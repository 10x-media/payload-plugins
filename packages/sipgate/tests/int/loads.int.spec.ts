import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { sipgate } from '../../src/index'

describeForDb('sipgate loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sipgate({}),
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

	it('plugin does not mutate config in passthrough mode', () => {
		expect(booted.payload.collections).toBeDefined()
	})
})
