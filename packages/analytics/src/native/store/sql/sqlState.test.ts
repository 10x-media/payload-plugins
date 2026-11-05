import { describe, expect, it } from 'vitest'
import { recordingExecutor } from '../../../testing/recordingExecutor'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import type { DayMarker } from '../types'
import type { DriverResult } from './drivers'
import type { SqlRow } from './executor'
import { compile, raw } from './fragment'
import { sqlStateStore } from './sqlState'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const MINUTE = 60_000

/** The state table's executor, answering each statement what `answer` returns for its text. */
const fakeExecutor = (dialect: SqlDialect, answer?: (text: string) => Partial<DriverResult>) =>
	recordingExecutor(dialect, {
		table: () =>
			raw(dialect.name === 'postgres' ? '"stats"."analytics_state"' : '"analytics_state"'),
		answer,
	})

const clock = () => {
	let current = NOW.getTime()
	return {
		now: () => new Date(current),
		advance: (ms: number) => {
			current += ms
		},
	}
}

const marker = (overrides: Partial<DayMarker> = {}): DayMarker => ({
	scope: 'a',
	day: 20261005,
	tz: 'UTC',
	start: null,
	status: 'provisional',
	version: 1,
	gen: 'run-1',
	hits: 12,
	leaseOwner: 'run-1',
	leaseUntil: null,
	finalAfter: new Date('2026-10-07T00:15:00.000Z'),
	aggregatedAt: NOW,
	...overrides,
})

describe('sqlStateStore leases', () => {
	it('claims a lease key in one conditional upsert, stamped from its clock', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, () => ({ rowCount: 1 }))
		const time = clock()
		const store = sqlStateStore(executor, { now: time.now })
		time.advance(5 * MINUTE)
		await expect(store.claim('lease:maintain', 'run-1', 10 * MINUTE)).resolves.toBe(true)
		expect(statements).toEqual([
			{
				text: 'INSERT INTO "stats"."analytics_state" AS "s" ("id", "kind", "scope", "lease_owner", "lease_until") VALUES ($1, $2, $3, $4, $5) ON CONFLICT ("id") DO UPDATE SET "lease_owner" = excluded."lease_owner", "lease_until" = excluded."lease_until" WHERE ("s"."lease_until" IS NULL OR "s"."lease_until" < $6 OR "s"."lease_owner" = $7)',
				values: [
					'lease:maintain',
					'lease',
					'',
					'run-1',
					'2026-10-06T12:15:00.000Z',
					'2026-10-06T12:05:00.000Z',
					'run-1',
				],
			},
		])
	})

	it('claims a day marker with a plain conditional update, which wins nothing without the row', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		const store = sqlStateStore(executor, { now: () => NOW })
		await expect(store.claim('day:a:20261005', 'run-2', 10 * MINUTE)).resolves.toBe(false)
		expect(statements).toEqual([
			{
				text: 'UPDATE "analytics_state" SET "lease_owner" = ?, "lease_until" = ? WHERE "id" = ? AND ("lease_until" IS NULL OR "lease_until" < ? OR "lease_owner" = ?)',
				values: [
					'run-2',
					'2026-10-06T12:10:00.000Z',
					'day:a:20261005',
					'2026-10-06T12:00:00.000Z',
					'run-2',
				],
			},
		])
	})

	it('refuses to lease a salt or a heartbeat', async () => {
		const store = sqlStateStore(fakeExecutor(postgresDialect).executor, { now: () => NOW })
		await expect(store.claim('salt:2026-10-05', 'run', MINUTE)).rejects.toThrow(
			/neither a lease nor a day marker/
		)
		await expect(store.claim('heartbeat:analytics-maintain', 'run', MINUTE)).rejects.toThrow(
			/neither a lease nor a day marker/
		)
	})

	it('releases and completes only for the owner holding the lease', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, () => ({ rowCount: 1 }))
		const store = sqlStateStore(executor, { now: () => NOW })
		await expect(store.release('lease:maintain', 'run-1')).resolves.toBe(true)
		await expect(store.complete(marker(), 'run-1')).resolves.toBe(true)
		expect(statements.map((statement) => statement.text)).toEqual([
			'UPDATE "stats"."analytics_state" SET "lease_owner" = $1, "lease_until" = $2 WHERE "id" = $3 AND "lease_owner" = $4',
			'UPDATE "stats"."analytics_state" SET "status" = $1, "tz" = $2, "value" = $3, "version" = $4, "gen" = $5, "hits" = $6, "final_after" = $7, "aggregated_at" = $8, "lease_owner" = $9, "lease_until" = $10 WHERE "id" = $11 AND "lease_owner" = $12',
		])
		expect(statements[1]?.values).toEqual([
			'provisional',
			'UTC',
			null,
			1,
			'run-1',
			12,
			'2026-10-07T00:15:00.000Z',
			'2026-10-06T12:00:00.000Z',
			null,
			null,
			'day:a:20261005',
			'run-1',
		])
	})

	it('hands out the very statement it completes a day with, for a caller’s batch', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, () => ({ rowCount: 1 }))
		const store = sqlStateStore(executor, { now: () => NOW })
		await expect(store.complete(marker(), 'run-1')).resolves.toBe(true)
		expect(compile(store.completion(marker(), 'run-1'), postgresDialect)).toEqual({
			text: expect.stringContaining('"analytics_state" SET "status" = $1'),
			values: statements[0]?.values,
		})
	})

	it('completes a clean marker only while the day is not dirty', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, () => ({ rowCount: 0 }))
		const store = sqlStateStore(executor, { now: () => NOW })
		await expect(store.complete(marker(), 'run-1', { clean: true })).resolves.toBe(false)
		expect(statements[0]?.text).toMatch(
			/WHERE "id" = \? AND "lease_owner" = \? AND "status" <> \?$/
		)
		expect(statements[0]?.values.slice(-3)).toEqual(['day:a:20261005', 'run-1', 'dirty'])
		await store.complete(marker(), 'run-1')
		expect(statements[1]?.text).toMatch(/AND "lease_owner" = \?$/)
	})

	it('keeps where a task’s run stopped in one upsert, and reads it back', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, (text) =>
			text.startsWith('SELECT') ? { rows: [{ value: '{"cursor":"\\"b\\""}' }] } : {}
		)
		const store = sqlStateStore(executor, { now: () => NOW })
		await store.setCursor('analytics-sync', '"b"')
		expect(statements[0]).toEqual({
			text: 'INSERT INTO "analytics_state" ("id", "kind", "scope", "value") VALUES (?, ?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "value" = excluded."value"',
			values: ['cursor:analytics-sync', 'cursor', '', '{"cursor":"\\"b\\""}'],
		})
		expect(await store.cursor('analytics-sync')).toBe('"b"')
		expect(statements[1]?.values).toEqual(['cursor:analytics-sync'])
	})

	it('revokes the lease of a day it marks dirty, so the next run may claim it, and forgets its failures', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		await sqlStateStore(executor, { now: () => NOW }).markDirty('a', [20261005, 20261006, 20261005])
		expect(statements).toEqual([
			{
				text: 'UPDATE "analytics_state" SET "status" = ?, "lease_owner" = ?, "lease_until" = ?, "value" = json_remove("value", \'$.failures\') WHERE "id" IN (?, ?) AND "kind" = ?',
				values: ['dirty', null, null, 'day:a:20261005', 'day:a:20261006', 'day'],
			},
		])
	})

	it('renews a lease only for the owner still holding it, expired or not', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		await sqlStateStore(executor, { now: () => NOW }).renew('day:a:20261005', 'run-1', MINUTE)
		expect(statements).toEqual([
			{
				text: 'UPDATE "stats"."analytics_state" SET "lease_until" = $1 WHERE "id" = $2 AND "lease_owner" = $3',
				values: [new Date(NOW.getTime() + MINUTE).toISOString(), 'day:a:20261005', 'run-1'],
			},
		])
	})
})

describe('sqlStateStore markers', () => {
	it('creates missing markers open, final a day and a quarter hour after they end', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		await sqlStateStore(executor).ensureMarkers([
			{ scope: 'a', day: 20261005, tz: 'America/New_York' },
			{ scope: 'a', day: 20261005, tz: 'America/New_York' },
		])
		expect(statements).toEqual([
			{
				text: 'INSERT INTO "stats"."analytics_state" ("id", "kind", "scope", "day", "tz", "status", "final_after") VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT ("id") DO NOTHING',
				values: [
					'day:a:20261005',
					'day',
					'a',
					20261005,
					'America/New_York',
					'open',
					'2026-10-07T04:15:00.000Z',
				],
			},
		])
	})

	it('reads a scope markers off its (kind, scope, day) index however long, oldest day first', async () => {
		const rows: SqlRow[] = [
			{ scope: 'a', day: '20261006', tz: 'UTC', status: 'open' },
			{ scope: 'a', day: '20261005', tz: 'UTC', status: 'final' },
		]
		const { executor, statements } = fakeExecutor(postgresDialect, (text) =>
			text.startsWith('SELECT') ? { rows } : {}
		)
		const markers = await sqlStateStore(executor).markers('a', 19700101, 20261007)
		expect(markers.map((found) => [found.day, found.status])).toEqual([
			[20261005, 'final'],
			[20261006, 'open'],
		])
		expect(statements).toEqual([
			{
				text: 'SELECT "scope", "day", "tz", "value", "status", "version", "gen", "hits", "lease_owner" AS "leaseOwner", "lease_until" AS "leaseUntil", "final_after" AS "finalAfter", "aggregated_at" AS "aggregatedAt" FROM "stats"."analytics_state" WHERE "kind" = $1 AND "scope" = $2 AND "day" >= $3 AND "day" <= $4 ORDER BY "day"',
				values: ['day', 'a', 19700101, 20261007],
			},
		])
	})

	it('reads no markers, and asks nothing, for a range that ends before it starts', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		await expect(sqlStateStore(executor).markers('a', 20261005, 20261001)).resolves.toEqual([])
		expect(statements).toEqual([])
	})

	it('selects the due markers with every instant bound from the one it was given', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect)
		await sqlStateStore(executor, { now: () => new Date(0) }).pending(NOW, 25)
		expect(statements[0]?.text).toBe(
			'SELECT "scope", "day", "tz", "value", "status", "version", "gen", "hits", "lease_owner" AS "leaseOwner", "lease_until" AS "leaseUntil", "final_after" AS "finalAfter", "aggregated_at" AS "aggregatedAt" FROM "analytics_state" WHERE "kind" = ? AND ("lease_until" IS NULL OR "lease_until" < ?) AND ("status" = ? OR ("status" IN (?, ?) AND "final_after" <= ?) OR ("status" = ? AND "final_after" <= ?)) ORDER BY "day", "scope" LIMIT ?'
		)
		expect(statements[0]?.values).toEqual([
			'day',
			'2026-10-06T12:00:00.000Z',
			'dirty',
			'open',
			'partial',
			'2026-10-07T12:00:00.000Z',
			'provisional',
			'2026-10-06T12:00:00.000Z',
			25,
		])
		await expect(sqlStateStore(executor).pending(NOW, 0)).rejects.toThrow(RangeError)
	})
})

describe('sqlStateStore salts and heartbeats', () => {
	it('inserts a salt if absent and answers the one stored, parsing SQLite’s JSON text', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, (text) =>
			text.startsWith('SELECT') ? { rows: [{ value: '"kept"' }] } : { rowCount: 0 }
		)
		await expect(sqlStateStore(executor).salt(20261005)).resolves.toBe('kept')
		expect(statements[0]?.text).toBe(
			'INSERT INTO "analytics_state" ("id", "kind", "scope", "day", "value", "expires_at") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT ("id") DO NOTHING'
		)
		const [key, kind, scope, day, salt, expiresAt] = statements[0]?.values ?? []
		expect([key, kind, scope, day, expiresAt]).toEqual([
			'salt:2026-10-05',
			'salt',
			'',
			20261005,
			'2026-10-08T00:00:00.000Z',
		])
		expect(JSON.parse(String(salt))).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(statements[1]).toEqual({
			text: 'SELECT "value" FROM "analytics_state" WHERE "id" = ?',
			values: ['salt:2026-10-05'],
		})
	})

	it('binds JSON as jsonb on Postgres and takes the value node-postgres already parsed', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, (text) =>
			text.startsWith('SELECT') ? { rows: [{ value: 'kept' }] } : {}
		)
		await expect(sqlStateStore(executor).salt(20261005)).resolves.toBe('kept')
		expect(statements[0]?.text).toContain('VALUES ($1, $2, $3, $4, $5::jsonb, $6)')
	})

	it('refuses a salt it cannot read back', async () => {
		const { executor } = fakeExecutor(postgresDialect)
		await expect(sqlStateStore(executor, { now: () => NOW }).salt(20261005)).rejects.toThrow(
			/could not be read back/
		)
	})

	// A backdated hit asks for a day whose salt has expired; a sweep may delete it before the read.
	it('takes the salt it wrote for an expired day a sweep deleted before it was read back', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect)
		const expired = new Date('2026-10-08T00:00:00.000Z')
		const salt = await sqlStateStore(executor, { now: () => expired }).salt(20261005)
		expect(JSON.parse(String(statements[0]?.values[4]))).toBe(salt)
		expect(salt).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it('upserts a heartbeat stamped from its clock, and reads it back', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, (text) =>
			text.startsWith('SELECT') ? { rows: [{ value: '{"at":"2026-10-06T12:00:00.000Z"}' }] } : {}
		)
		const store = sqlStateStore(executor, { now: () => NOW })
		await store.beat('analytics-maintain')
		expect(statements[0]).toEqual({
			text: 'INSERT INTO "analytics_state" ("id", "kind", "scope", "value") VALUES (?, ?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "value" = excluded."value"',
			values: [
				'heartbeat:analytics-maintain',
				'heartbeat',
				'',
				'{"at":"2026-10-06T12:00:00.000Z"}',
			],
		})
		expect((await store.lastBeat('analytics-maintain'))?.toISOString()).toBe(
			'2026-10-06T12:00:00.000Z'
		)
	})

	it('answers no heartbeat for a task that never beat', async () => {
		const { executor } = fakeExecutor(postgresDialect)
		await expect(sqlStateStore(executor).lastBeat('analytics-sync')).resolves.toBeNull()
	})

	it('upserts a scope’s configuration token and reads it back', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, (text) =>
			text.startsWith('SELECT') ? { rows: [{ value: '{"token":"t-1"}' }] } : {}
		)
		const store = sqlStateStore(executor)
		await store.setConfigToken('tenant-a', 't-1')
		expect(statements[0]).toEqual({
			text: 'INSERT INTO "analytics_state" ("id", "kind", "scope", "value") VALUES (?, ?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "value" = excluded."value"',
			values: ['epoch:tenant-a', 'epoch', 'tenant-a', '{"token":"t-1"}'],
		})
		await expect(store.configToken('tenant-a')).resolves.toBe('t-1')
		expect(statements[1]?.values).toEqual(['epoch:tenant-a'])
	})

	it('answers no configuration token for a scope that never stored one', async () => {
		const { executor } = fakeExecutor(postgresDialect)
		await expect(sqlStateStore(executor).configToken('')).resolves.toBeNull()
	})

	it('sweeps the salts whose expiry has come, answering how many', async () => {
		const { executor, statements } = fakeExecutor(postgresDialect, () => ({ rowCount: 3 }))
		await expect(sqlStateStore(executor).sweep(NOW)).resolves.toBe(3)
		expect(statements).toEqual([
			{
				text: 'DELETE FROM "stats"."analytics_state" WHERE "kind" = $1 AND "expires_at" <= $2',
				values: ['salt', '2026-10-06T12:00:00.000Z'],
			},
		])
	})

	it('drops a scope’s day markers before a day, answering how many', async () => {
		const { executor, statements } = fakeExecutor(sqliteDialect, () => ({ rowCount: 4 }))
		await expect(sqlStateStore(executor).dropMarkers('a', 20260701)).resolves.toBe(4)
		expect(statements).toEqual([
			{
				text: 'DELETE FROM "analytics_state" WHERE "kind" = ? AND "scope" = ? AND "day" < ?',
				values: ['day', 'a', 20260701],
			},
		])
	})
})
