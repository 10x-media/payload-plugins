import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, KVAdapterResult } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ContentLockedError, contentLock } from '../../src/index'

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

const failingKV: KVAdapterResult = {
	init: () => ({
		clear: async () => undefined,
		delete: async () => undefined,
		get: async () => null,
		has: async () => false,
		keys: async () => [],
		set: async () => {
			throw new Error('kv unavailable')
		},
	}),
}

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

// The kv adapter under test is independent of the database, so one lane covers it.
describeForDb('contentLock boot with an unavailable kv', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [posts],
			configOverrides: { kv: failingKV },
			plugin: contentLock({}),
		})
	})

	afterAll(async () => {
		await booted?.stop()
	})

	it('boots when the startup snapshot cannot be stored, and rejects writes until it can', async () => {
		expect(booted.payload).toBeDefined()
		await expect(
			booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
	})
})
