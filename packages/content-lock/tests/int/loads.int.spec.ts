import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { contentLock } from '../../src/index'

describeForDb('contentLock loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: contentLock({}),
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

	it('offers no scope fields without groups or individual selection', () => {
		const fields = booted.payload.collections['content-locks']?.config.flattenedFields ?? []
		const names = fields.map((field) => field.name)
		expect(names).toContain('startsAt')
		expect(names).not.toContain('lockEverything')
		expect(names).not.toContain('groups')
	})
})
