import { spawn } from 'node:child_process'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { numberOf } from '../../src/native/store/columnValues'
import {
	createSqlExecutor,
	type SqlExecutor,
	type SqlSession,
} from '../../src/native/store/sql/executor'
import { ident, join, json, raw, sql } from '../../src/native/store/sql/fragment'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const SCRATCH = 'analytics_executor_scratch'

/**
 * Another writer on the same SQLite file, in its own process like a jobs worker. A thread would
 * not do: two SQLite copies in one process never see each other's locks.
 */
const WRITER = `
const [path, id, holdMs] = process.argv.slice(1)
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(path)
db.exec('BEGIN IMMEDIATE')
db.prepare("INSERT INTO ${SCRATCH} (id, n, at) VALUES (?, 1, '2026-10-05T00:00:00.000Z')").run(id)
process.stdout.write('locked\\n')
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs))
db.exec('COMMIT')
db.close()
process.stdout.write('committed\\n')
`

const instantOf = (value: unknown): string =>
	value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()

const jsonOf = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value)

describeForDb('analytics SQL executor', {}, (db) => {
	if (db === 'mongo') {
		it.skip('runs on the SQL databases only', () => undefined)
		return
	}

	let booted: BootedPayload
	let executor: SqlExecutor

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: analytics({ adapters: [memoryAdapter()] }) })
		executor = createSqlExecutor(booted.payload)
		const columns =
			db === 'postgres'
				? 'id varchar PRIMARY KEY, n integer NOT NULL, at timestamp(3) with time zone NOT NULL, flag boolean, props jsonb'
				: 'id text PRIMARY KEY, n integer NOT NULL, at text NOT NULL, flag integer, props text'
		await executor.execute(sql`CREATE TABLE ${ident(SCRATCH)} (${raw(columns)})`)
	}, 240_000)

	afterAll(async () => {
		await executor?.execute(sql`DROP TABLE IF EXISTS ${ident(SCRATCH)}`)
		await booted?.stop()
	})

	beforeEach(async () => {
		await executor.execute(sql`DELETE FROM ${ident(SCRATCH)}`)
	})

	const insert = (rows: Array<{ id: string; n: number; at: string; flag?: boolean }>) =>
		executor.execute(
			sql`INSERT INTO ${ident(SCRATCH)} (id, n, at, flag) VALUES ${join(
				rows.map((row) => sql`(${row.id}, ${row.n}, ${new Date(row.at)}, ${row.flag ?? null})`)
			)}`
		)

	const ids = async (): Promise<string[]> =>
		(await executor.select(sql`SELECT id FROM ${ident(SCRATCH)} ORDER BY id`)).map((row) =>
			String(row.id)
		)

	it('binds every value as a parameter and reads the rows back', async () => {
		const written = await insert([
			{ id: 'a', n: 1, at: '2026-10-05T09:00:00.000Z', flag: true },
			{ id: 'b', n: 2, at: '2026-10-05T10:00:00.000Z', flag: false },
			{ id: "c'; DROP TABLE x; --", n: 3, at: '2026-10-05T11:00:00.000Z' },
		])
		expect(written.rowCount).toBe(3)
		const rows = await executor.select(
			sql`SELECT id, n, at FROM ${ident(SCRATCH)} WHERE ${executor.dialect.isTrue(ident('flag'))}`
		)
		expect(rows.map((row) => [row.id, numberOf(row.n), instantOf(row.at)])).toEqual([
			['a', 1, '2026-10-05T09:00:00.000Z'],
		])
		expect(await ids()).toEqual(['a', 'b', "c'; DROP TABLE x; --"])
	})

	it('compares instants as time, and sums as numbers', async () => {
		await insert([
			{ id: 'a', n: 1, at: '2026-10-05T09:00:00.000Z' },
			{ id: 'b', n: 2, at: '2026-10-05T10:00:00.000Z' },
			{ id: 'c', n: 40, at: '2026-10-05T11:00:00.000Z' },
		])
		const [window] = await executor.select(
			sql`SELECT COUNT(*) AS hits, SUM(n) AS total FROM ${ident(SCRATCH)}
				WHERE at >= ${new Date('2026-10-05T09:30:00.000Z')} AND at < ${new Date('2026-10-05T11:00:00.000Z')}`
		)
		expect(numberOf(window?.hits)).toBe(1)
		expect(numberOf(window?.total)).toBe(2)
		const [all] = await executor.select(sql`SELECT SUM(n) AS total FROM ${ident(SCRATCH)}`)
		expect(numberOf(all?.total)).toBe(43)
	})

	it('binds JSON and reads it back whole', async () => {
		await executor.execute(
			sql`INSERT INTO ${ident(SCRATCH)} (id, n, at, props) VALUES (${'j'}, ${1}, ${new Date('2026-10-05T00:00:00.000Z')}, ${json({ goals: [{ slug: 'buy', value: 9.5 }] })})`
		)
		const [row] = await executor.select(sql`SELECT props FROM ${ident(SCRATCH)} WHERE id = ${'j'}`)
		expect(jsonOf(row?.props)).toEqual({ goals: [{ slug: 'buy', value: 9.5 }] })
	})

	it('matches a substring ignoring case, its wildcards taken literally', async () => {
		await insert([
			{ id: 'Sale_50%', n: 1, at: '2026-10-05T00:00:00.000Z' },
			{ id: 'sale-50x', n: 1, at: '2026-10-05T00:00:00.000Z' },
			{ id: 'other', n: 1, at: '2026-10-05T00:00:00.000Z' },
		])
		const matching = async (value: string) =>
			(
				await executor.select(
					sql`SELECT id FROM ${ident(SCRATCH)} WHERE ${executor.dialect.contains(ident('id'), value)} ORDER BY id`
				)
			).map((row) => row.id)
		expect(await matching('_50%')).toEqual(['Sale_50%'])
		expect(await matching('SALE')).toEqual(['Sale_50%', 'sale-50x'])
	})

	it('commits a transaction that resolves', async () => {
		const answer = await executor.transaction(async (tx) => {
			await tx.execute(
				sql`INSERT INTO ${ident(SCRATCH)} (id, n, at) VALUES (${'t'}, ${1}, ${new Date('2026-10-05T00:00:00.000Z')})`
			)
			const inside = await tx.select(sql`SELECT COUNT(*) AS c FROM ${ident(SCRATCH)}`)
			return numberOf(inside[0]?.c)
		})
		expect(answer).toBe(1)
		expect(await ids()).toEqual(['t'])
	})

	it('rolls back a transaction that throws, and throws its own error', async () => {
		const failing = executor.transaction(async (tx) => {
			await tx.execute(
				sql`INSERT INTO ${ident(SCRATCH)} (id, n, at) VALUES (${'r'}, ${1}, ${new Date('2026-10-05T00:00:00.000Z')})`
			)
			throw new Error('work failed')
		})
		await expect(failing).rejects.toThrow('work failed')
		expect(await ids()).toEqual([])
	})

	it('counts the rows an update changed', async () => {
		await insert([
			{ id: 'a', n: 1, at: '2026-10-05T00:00:00.000Z' },
			{ id: 'b', n: 1, at: '2026-10-05T00:00:00.000Z' },
		])
		const updated = await executor.execute(
			sql`UPDATE ${ident(SCRATCH)} SET n = n + ${1} WHERE id = ${'a'}`
		)
		expect(updated.rowCount).toBe(1)
	})

	if (db === 'postgres') {
		it('cancels a transaction statement that outruns its timeout', async () => {
			const slow = executor.transaction(
				async (tx) => {
					await tx.select(sql`SELECT pg_sleep(2)`)
				},
				{ timeoutMs: 50 }
			)
			await expect(slow).rejects.toThrow(/statement timeout/)
		})
	}

	if (db === 'sqlite') {
		const path = (): string => booted.connectionString.replace(/^file:/, '')

		/** Starts the other writer and resolves once it holds the lock. */
		const otherWriter = async (id: string) => {
			const child = spawn(process.execPath, ['--no-warnings', '-e', WRITER, path(), id, '400'], {
				stdio: ['ignore', 'pipe', 'pipe'],
			})
			let output = ''
			let errors = ''
			const waiting: Array<{ line: string; resolve: () => void; reject: (err: Error) => void }> = []
			const settle = () => {
				for (const waiter of [...waiting]) {
					if (output.includes(waiter.line)) {
						waiting.splice(waiting.indexOf(waiter), 1)
						waiter.resolve()
					}
				}
			}
			child.stdout.on('data', (chunk: Buffer) => {
				output += chunk.toString()
				settle()
			})
			child.stderr.on('data', (chunk: Buffer) => {
				errors += chunk.toString()
			})
			child.on('exit', (code) => {
				settle()
				for (const waiter of waiting.splice(0)) {
					waiter.reject(new Error(`the other writer exited (${code}): ${errors}`))
				}
			})
			const reached = (line: string) =>
				new Promise<void>((resolve, reject) => {
					waiting.push({ line, resolve, reject })
					settle()
				})
			await reached('locked')
			return {
				committed: reached('committed'),
				done: () => {
					if (child.exitCode === null) {
						child.kill()
					}
				},
			}
		}

		const insertRow = (on: SqlExecutor | SqlSession, id: string) =>
			on.execute(
				sql`INSERT INTO ${ident(SCRATCH)} (id, n, at) VALUES (${id}, ${1}, ${new Date('2026-10-05T00:00:00.000Z')})`
			)

		it('waits for another writer’s lock rather than failing with SQLITE_BUSY', async () => {
			// A transaction hands the client's connection away, so the next one opens without the
			// adapter's busy timeout: exactly the connection a write would otherwise fail on.
			await executor.transaction(async () => undefined)
			const writer = await otherWriter('worker-1')
			try {
				await insertRow(executor, 'main')
				await writer.committed
			} finally {
				writer.done()
			}
			expect(await ids()).toEqual(['main', 'worker-1'])
		})

		it('waits for it in a transaction too', async () => {
			await executor.transaction(async () => undefined)
			const writer = await otherWriter('worker-2')
			try {
				await executor.transaction((tx) => insertRow(tx, 'main-tx'))
				await writer.committed
			} finally {
				writer.done()
			}
			expect(await ids()).toEqual(['main-tx', 'worker-2'])
		})

		it('fails with SQLITE_BUSY once the wait runs out, and loses nothing written after', async () => {
			const impatient = createSqlExecutor(booted.payload, { busyTimeoutMs: 20 })
			const writer = await otherWriter('worker-3')
			try {
				await expect(insertRow(impatient, 'too-soon')).rejects.toThrow(/SQLITE_BUSY/)
				await writer.committed
			} finally {
				writer.done()
			}
			// libsql leaves the failed statement running on its connection, where nothing would
			// commit again: the executor put that connection aside, so these land.
			await insertRow(impatient, 'after')
			await impatient.transaction((tx) => insertRow(tx, 'after-tx'))
			expect(await ids()).toEqual(['after', 'after-tx', 'worker-3'])
		})
	}
})
