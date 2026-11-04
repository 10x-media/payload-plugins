import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { adminWiki } from '../../src/index'

describeForDb('adminWiki loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: adminWiki({}),
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

	it('keeps wiki media unversioned, as on Payload 3', () => {
		expect(booted.payload.collections['wiki-media']?.config.versions).toBeFalsy()
		expect(booted.payload.collections['wiki-pages']?.config.versions).toMatchObject({ drafts: {} })
	})
})
