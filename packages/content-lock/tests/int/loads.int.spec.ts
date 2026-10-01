import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type CollectionConfig,
	createLocalReq,
	type KVAdapter,
	type KVAdapterResult,
} from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { assertContentUnlocked, ContentLockedError, contentLock } from '../../src/index'
import { forgetWindows } from '../../src/state/store'

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

/** Answers every read with nothing and rejects every write, like Redis at maxmemory under `volatile-lru`. */
const rejectingWrites = (): KVAdapter => ({
	clear: async () => undefined,
	delete: async () => undefined,
	get: async () => null,
	has: async () => false,
	keys: async () => [],
	set: async () => {
		throw new Error('kv rejects writes')
	},
})

const writeRejectingKV: KVAdapterResult = { init: rejectingWrites }

/** Fails reads too, like an unreachable Redis. */
const unavailableKV: KVAdapterResult = {
	init: () => ({
		...rejectingWrites(),
		get: async () => {
			throw new Error('kv unavailable')
		},
	}),
}

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

// The kv adapters under test are independent of the database, so one lane covers them.
describeForDb('contentLock with an unavailable kv', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [posts],
			configOverrides: { kv: unavailableKV },
			plugin: contentLock({}),
		})
	})

	afterAll(async () => {
		await booted?.stop()
	})

	it('boots, and rejects writes until the lock state can be read', async () => {
		expect(booted.payload).toBeDefined()
		await expect(
			booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
	})

	it('keeps exempt collections unlocked while the lock state cannot be read', async () => {
		const req = await createLocalReq({}, booted.payload)
		await expect(
			assertContentUnlocked(req, { collection: 'content-locks' })
		).resolves.toBeUndefined()
		await expect(assertContentUnlocked(req, { collection: 'posts' })).rejects.toBeInstanceOf(
			ContentLockedError
		)
	})
})

describeForDb('contentLock with a kv that rejects writes', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [posts],
			configOverrides: { kv: writeRejectingKV },
			plugin: contentLock({}),
		})
	})

	afterAll(async () => {
		await booted?.stop()
	})

	it('boots, and enforces the windows read from the collection', async () => {
		const { payload } = booted
		await expect(
			payload.create({ collection: 'posts', data: { title: 'open' }, overrideAccess: true })
		).resolves.toMatchObject({ title: 'open' })

		// A window write fails while its snapshot cannot be stored, so this one goes in behind the hooks.
		await payload.db.create({
			collection: 'content-locks',
			data: {
				_status: 'published',
				startsAt: new Date(Date.now() - 60_000).toISOString(),
				title: 'Migration',
			},
		})
		forgetWindows(payload)
		await expect(
			payload.create({ collection: 'posts', data: { title: 'locked' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
	})
})
