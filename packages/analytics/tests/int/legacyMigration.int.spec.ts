import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isRecord } from '../../src/core/values'
import {
	deleteLegacyCache,
	deleteLegacySalts,
	dropLegacyNative,
	LEGACY_PRUNE_TASK,
	LEGACY_SALT_PREFIX,
	LEGACY_WARM_TASK,
} from '../../src/exports/migrations'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { countHits, nativeOf, pageviewHit } from './nativeHelpers'

const PREDEFINED = fileURLToPath(
	new URL('../../src/migrations/predefined/dropLegacyMongo.ts', import.meta.url)
)

/** The slice of the driver's `Db` these specs plant beta.11 data with. */
interface DriverDb {
	collection(name: string): {
		insertMany(docs: object[]): Promise<unknown>
		createIndex(keys: object, options?: object): Promise<unknown>
		countDocuments(filter: object): Promise<number>
	}
	listCollections(filter: object, options: object): { toArray(): Promise<unknown[]> }
}

const driverDbOf = (payload: Payload): DriverDb => {
	const connection: unknown = Reflect.get(payload.db, 'connection')
	const db: unknown = isRecord(connection) ? connection.db : undefined
	if (!isRecord(db) || typeof db.collection !== 'function') {
		throw new Error('the Mongo adapter exposes its driver database once connected')
	}
	return db as unknown as DriverDb
}

const collectionNames = async (payload: Payload): Promise<string[]> =>
	(await driverDbOf(payload).listCollections({}, { nameOnly: true }).toArray())
		.flatMap((entry) => (isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : []))
		.sort()

/**
 * What beta.11 left in MongoDB: events, rollups and seen ledger (under beta.11's plural names),
 * their indexes, two days of salts, and its queued retention run beside one of this version's.
 */
const plantBeta11 = async (payload: Payload): Promise<void> => {
	const db = driverDbOf(payload)
	const at = new Date('2026-10-01T10:00:00.000Z')
	await db.collection('analytics-events').insertMany([
		{ timestamp: at, type: 'pageview', path: '/', hostname: 'h', visitorHash: 'a', sessionId: 's' },
		{ timestamp: at, type: 'goal', name: 'purchase', path: '/c', hostname: 'h', visitorHash: 'b' },
	])
	await db.collection('analytics-events').createIndex({ path: 1, timestamp: 1 })
	await db
		.collection('analytics-rollups')
		.insertMany([
			{ granularity: 'day', period: at, path: '/', dimension: '', dimvalue: '', pageviews: 1 },
		])
	await db
		.collection('analytics-rollups')
		.createIndex(
			{ granularity: 1, period: 1, path: 1, dimension: 1, dimvalue: 1 },
			{ unique: true }
		)
	await db
		.collection('analytics-seens')
		.insertMany([{ bucket: 'b', kind: 'v', value: 'a', period: at }])
	await payload.kv.set(`${LEGACY_SALT_PREFIX}2026-09-30`, { salt: 'old' })
	await payload.kv.set(`${LEGACY_SALT_PREFIX}2026-10-01`, { salt: 'older' })
	await payload.kv.set('analytics:epoch:global', { value: 'kept' })
	await payload.kv.set('analytics|e0|ga4|_|/|pageviews||2026-01-01_2026-02-01|_||_|_', {
		value: {},
	})
	await db.collection('payload-jobs').insertMany([
		{ taskSlug: LEGACY_PRUNE_TASK, queue: 'default', waitUntil: at, processing: false },
		{ taskSlug: LEGACY_WARM_TASK, queue: 'default', waitUntil: at, processing: false },
		{ taskSlug: MAINTAIN_TASK_SLUG, queue: 'default', waitUntil: at, processing: false },
	])
}

describeForDb('dropping the beta.11 native storage', {}, (db) => {
	let booted: BootedPayload
	let payload: Payload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
			db,
		})
		payload = booted.payload
	})

	afterAll(async () => {
		await booted?.stop()
	})

	it(`deletes the old salts from the key-value store, and only those, on ${db}`, async () => {
		await payload.kv.set(`${LEGACY_SALT_PREFIX}2026-09-29`, { salt: 'old' })
		await payload.kv.set('analytics:epoch:salts', { value: 'kept' })
		expect(await deleteLegacySalts({ payload })).toBe(1)
		expect(await deleteLegacySalts({ payload })).toBe(0)
		expect(await payload.kv.get('analytics:epoch:salts')).toEqual({ value: 'kept' })
	})

	it(`deletes the reads the old releases cached in the key-value store, and only those, on ${db}`, async () => {
		const legacy = [
			'analytics|e0|native|_|site|pageviews||2026-01-01_2026-02-01|day||_|_',
			'rt:e0:native:visitors:30:59012345',
			'rt:plausible:pageviews:5:59012345:tenant-a',
		]
		const kept = ['analytics:epoch:global', 'rt:other', 'form:rate:1']
		for (const key of [...legacy, ...kept]) {
			await payload.kv.set(key, { value: 'x' })
		}
		expect(await deleteLegacyCache({ payload })).toBe(legacy.length)
		expect(await deleteLegacyCache({ payload })).toBe(0)
		const left = await payload.kv.keys()
		expect(left).toEqual(expect.arrayContaining(kept))
		for (const key of kept) {
			await payload.kv.delete(key)
		}
	})

	it(`deletes many old keys a share at a time rather than one round trip each on ${db}`, async () => {
		const salts = Array.from(
			{ length: 1_200 },
			(_, index) => `${LEGACY_SALT_PREFIX}2025-${String(index).padStart(5, '0')}`
		)
		for (const key of salts) {
			await payload.kv.set(key, { salt: 'old' })
		}
		const deleteMany = payload.db.deleteMany
		const deleteOne = payload.kv.delete
		let bulk = 0
		let single = 0
		payload.db.deleteMany = (args) => {
			bulk += 1
			return deleteMany.call(payload.db, args)
		}
		payload.kv.delete = (key) => {
			single += 1
			return deleteOne.call(payload.kv, key)
		}
		try {
			expect(await deleteLegacySalts({ payload })).toBe(salts.length)
		} finally {
			payload.db.deleteMany = deleteMany
			payload.kv.delete = deleteOne
		}
		expect({ bulk, single }).toEqual({ bulk: 3, single: 0 })
		expect((await payload.kv.keys()).filter((key) => key.startsWith(LEGACY_SALT_PREFIX))).toEqual(
			[]
		)
	})

	if (db !== 'mongo') {
		it(`refuses on ${db}, where a generated migration drops the tables`, async () => {
			await expect(dropLegacyNative({ payload })).rejects.toThrow(/payload migrate:create/)
		})
		return
	}

	it('drops the three collections and the old salts, and leaves the new store alone', async () => {
		await plantBeta11(payload)
		await nativeOf(payload).store.append([
			pageviewHit({ ts: new Date('2026-10-06T10:00:00.000Z'), v: 'VVVVVVVVVVVVVVVV' }),
		])

		const report = await dropLegacyNative({ payload })

		expect(report).toEqual({
			collections: ['analytics-events', 'analytics-rollups', 'analytics-seens'],
			salts: 2,
			cached: 1,
			jobs: 2,
		})
		const left = await collectionNames(payload)
		expect(left.filter((name) => /^analytics-(events|rollups|seens?)$/.test(name))).toEqual([])
		expect(left).toContain('analytics-hits')
		expect(await countHits(payload)).toBe(1)
		expect(await payload.kv.get('analytics:epoch:global')).toEqual({ value: 'kept' })
		expect((await payload.kv.keys()).filter((key) => key.startsWith(LEGACY_SALT_PREFIX))).toEqual(
			[]
		)
		const jobs = driverDbOf(payload).collection('payload-jobs')
		expect(await jobs.countDocuments({ taskSlug: LEGACY_PRUNE_TASK })).toBe(0)
		expect(await jobs.countDocuments({ taskSlug: LEGACY_WARM_TASK })).toBe(0)
		expect(await jobs.countDocuments({ taskSlug: MAINTAIN_TASK_SLUG })).toBe(1)
	})

	it('finds nothing to do the second time', async () => {
		await expect(dropLegacyNative({ payload })).resolves.toEqual({
			collections: [],
			salts: 0,
			cached: 0,
			jobs: 0,
		})
	})

	it("is what Payload's migrate:create writes from the predefined migration", async () => {
		const dir = await mkdtemp(join(tmpdir(), 'analytics-migrations-'))
		const previous = payload.db.migrationDir
		payload.db.migrationDir = dir
		try {
			await payload.db.createMigration({
				file: PREDEFINED,
				forceAcceptWarning: true,
				migrationName: 'drop_legacy',
				payload,
			})
			const files = (await readdir(dir)).filter((name) => name.endsWith('_drop_legacy.ts'))
			expect(files).toHaveLength(1)
			const written = await readFile(join(dir, files[0] ?? ''), 'utf8')
			expect(written).toContain(
				"import { dropLegacyNative } from '@10x-media/analytics/migrations'"
			)
			expect(written).toMatch(
				/export async function up\([^)]*\)[^{]*\{\n\s+await dropLegacyNative\(\{ payload \}\)\n\}/
			)
			expect(written).toMatch(
				/export async function down\([^)]*\)[^{]*\{\n\s+\/\/ Nothing to restore/
			)
		} finally {
			payload.db.migrationDir = previous
			await rm(dir, { recursive: true, force: true })
		}
	})
})
