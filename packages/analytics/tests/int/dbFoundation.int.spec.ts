import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	type SupportedDb,
} from '@10x-media/payload-test-harness'
import type { MongooseAdapter } from '@payloadcms/db-mongodb'
import { type CollectionConfig, createLocalReq, type Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { captureRequest } from '../../src/capture/captureRequest'
import { isUniqueViolation } from '../../src/db/errors'
import { dbKind } from '../../src/db/kind'
import { analytics } from '../../src/index'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const PROBES = 'db-probes'

const SECRETS = 'db-secrets'
const USERS = 'db-users'

const probes: CollectionConfig = {
	slug: PROBES,
	access: { read: () => true },
	fields: [
		{ name: 'key', type: 'text', required: true, unique: true },
		{ name: 'note', type: 'text' },
		{ name: 'related', type: 'relationship', relationTo: PROBES },
		{ name: 'secret', type: 'relationship', relationTo: SECRETS },
	],
}

/** Readable by a signed-in user only, so a populated one shows whose access answered. */
const secrets: CollectionConfig = {
	slug: SECRETS,
	access: { read: ({ req }) => Boolean(req.user) },
	fields: [{ name: 'title', type: 'text' }],
}

const users: CollectionConfig = { slug: USERS, auth: true, fields: [] }

/** The slice of a drizzle adapter these probes reach past Payload's base adapter type for. */
interface SqlAdapter {
	drizzle: unknown
	execute: (args: { drizzle: unknown; raw?: string; sql?: unknown }) => Promise<{
		rows: Array<Record<string, unknown>>
	}>
}

const sqlAdapter = (payload: Payload): SqlAdapter => payload.db as unknown as SqlAdapter

const plugin = () => analytics({ adapters: [memoryAdapter()] })

const failureOf = (write: Promise<unknown>): Promise<unknown> =>
	write.then(
		() => undefined,
		(err: unknown) => err
	)

/** A write straight through the driver, under Payload's adapter and its error conversion. */
const driverInsert = async (payload: Payload, db: SupportedDb, key: string): Promise<void> => {
	if (db === 'mongo') {
		await (payload.db as unknown as MongooseAdapter).collections[PROBES]?.collection.insertOne({
			key,
		})
		return
	}
	const adapter = sqlAdapter(payload)
	await adapter.execute({
		drizzle: adapter.drizzle,
		raw: `INSERT INTO db_probes (key) VALUES ('${key}')`,
	})
}

describeForDb('analytics database foundation', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: plugin(), collections: [probes, secrets, users] })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('names the database family it runs on', () => {
		expect(dbKind(booted.payload)).toBe(db)
	})

	it('recognizes a unique refusal raised through the Local API', async () => {
		const { payload } = booted
		await payload.create({ collection: PROBES, data: { key: 'local-api' } })
		const failure = await failureOf(
			payload.create({ collection: PROBES, data: { key: 'local-api' } })
		)
		expect(failure).toBeInstanceOf(Error)
		expect(isUniqueViolation(failure, payload)).toBe(true)
	})

	it('recognizes one raised through payload.db with a request of no transaction', async () => {
		const { payload } = booted
		const write = () => payload.db.create({ collection: PROBES, data: { key: 'adapter' }, req: {} })
		await write()
		const failure = await failureOf(write())
		expect(failure).toBeInstanceOf(Error)
		expect(isUniqueViolation(failure)).toBe(true)
	})

	it("recognizes the driver's own refusal", async () => {
		await driverInsert(booted.payload, db, 'driver')
		const failure = await failureOf(driverInsert(booted.payload, db, 'driver'))
		expect(failure).toBeInstanceOf(Error)
		expect(isUniqueViolation(failure)).toBe(true)
	})

	it('tells a unique refusal from any other failed write', async () => {
		const { payload } = booted
		const missingKey = await failureOf(payload.create({ collection: PROBES, data: { note: 'x' } }))
		expect(missingKey).toBeInstanceOf(Error)
		expect(isUniqueViolation(missingKey, payload)).toBe(false)
	})

	it("answers a capture request's depth read without the signed-in user's cached documents", async () => {
		const { payload } = booted
		const secret = await payload.create({ collection: SECRETS, data: { title: 'staff only' } })
		const page = await payload.create({
			collection: PROBES,
			data: { key: 'capture-page', secret: secret.id },
		})
		const admin = await payload.create({
			collection: USERS,
			data: { email: 'depth-admin@example.test', password: 'depth-admin-pw' },
		})
		const req = await createLocalReq({ user: { ...admin, collection: USERS } }, payload)
		const read = (as: typeof req) =>
			payload.findByID({
				collection: PROBES,
				id: page.id,
				depth: 1,
				overrideAccess: false,
				req: as,
			})
		expect((await read(req)).secret).toMatchObject({ title: 'staff only' })
		expect((await read(captureRequest(req))).secret).toBe(secret.id)
		expect((await read(req)).secret).toMatchObject({ title: 'staff only' })
	})
})
