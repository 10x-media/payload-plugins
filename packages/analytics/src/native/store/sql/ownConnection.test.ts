import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceMisconfiguredError } from '../../../core/sourceErrors'
import { isRecord } from '../../../core/values'
import { isLibsqlClient, type LibsqlClient, rowsOf } from './drivers'
import { closeOwnConnection, type OwnConnectionDeps, ownConnectionFor } from './ownConnection'
import { hostLibsqlNatives, resolveLibsqlClient } from './sqliteThread'

const resolved = resolveLibsqlClient(process.cwd())
if ('failure' in resolved) {
	throw new Error(resolved.failure)
}
const CLIENT_PATH = resolved.path

/** A client as the host's adapter opens one, from the copy of `@libsql/client` it loads. */
const openClient = (url: string): LibsqlClient => {
	const libsql: unknown = createRequire(import.meta.url)(CLIENT_PATH)
	const create = isRecord(libsql) ? libsql.createClient : undefined
	const client: unknown = typeof create === 'function' ? create({ url }) : undefined
	if (!isLibsqlClient(client)) {
		throw new Error('analytics test: @libsql/client did not load')
	}
	return client
}

describe('ownConnectionFor', () => {
	let dir: string
	let url: string
	let host: LibsqlClient

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), 'analytics-own-'))
		url = `file:${join(dir, 'own.db')}`
		host = openClient(url)
		await host.execute('PRAGMA journal_mode = WAL')
		await host.execute('CREATE TABLE t (v TEXT)')
	})

	afterEach(async () => {
		await closeOwnConnection(host)
		host.close?.()
		rmSync(dir, { recursive: true, force: true })
	})

	it('opens a second connection to the host’s file through the public createClient, once', async () => {
		const connection = await ownConnectionFor(host, { url }).get('transaction')
		expect(connection).not.toBeNull()
		expect(connection).not.toBe(host)
		expect(Object.getPrototypeOf(connection)).toBe(Object.getPrototypeOf(host))
		expect(await ownConnectionFor(host, { url }).get('transaction')).toBe(connection)
		await connection?.execute("INSERT INTO t VALUES ('own')")
		expect(rowsOf((await host.execute('SELECT v FROM t')).rows)).toEqual([{ v: 'own' }])
	})

	it('holds a write transaction apart from the host’s connection', async () => {
		const connection = await ownConnectionFor(host, { url }).get('transaction')
		await connection?.execute('BEGIN IMMEDIATE')
		await host.execute('PRAGMA busy_timeout = 0')
		await expect(host.execute("INSERT INTO t VALUES ('host')")).rejects.toMatchObject({
			code: 'SQLITE_BUSY',
		})
		await connection?.execute('ROLLBACK')
	})

	it('opens a fresh one once the one a statement failed on is let go of', async () => {
		const own = ownConnectionFor(host, { url })
		const first = await own.get('transaction')
		if (!first) {
			throw new Error('no own connection')
		}
		own.discard(first)
		const second = await own.get('transaction')
		expect(second).not.toBeNull()
		expect(second).not.toBe(first)
	})

	it('refuses a database in memory, which a second connection would open empty', async () => {
		const memory = openClient(':memory:')
		try {
			await expect(
				ownConnectionFor(memory, { url: ':memory:' }).get('transaction')
			).rejects.toBeInstanceOf(SourceMisconfiguredError)
		} finally {
			await closeOwnConnection(memory)
			memory.close?.()
		}
	})

	it('refuses an embedded replica, which syncs through the host’s client alone', async () => {
		await expect(
			ownConnectionFor(host, { url, syncUrl: 'libsql://replica.example' }).get('transaction')
		).rejects.toThrow(/embedded replica/)
	})

	it('keeps one connection per role, each of the host client’s own class', async () => {
		const own = ownConnectionFor(host, { url })
		const transactions = await own.get('transaction')
		const statements = await own.get('statement')
		expect(transactions).not.toBeNull()
		expect(statements).not.toBeNull()
		expect(statements).not.toBe(transactions)
		expect(await own.get('statement')).toBe(statements)
		if (!statements) {
			throw new Error('no own connection')
		}
		own.discard(statements)
		expect(await own.get('transaction')).toBe(transactions)
		expect(await own.get('statement')).not.toBe(statements)
	})

	it('fails every use, warning once per client why, rather than run on the host’s client', async () => {
		const memory = openClient(':memory:')
		const warn = vi.fn()
		try {
			const own = ownConnectionFor(memory, { url: ':memory:' }, { warn })
			await expect(own.get('transaction')).rejects.toThrow(/in memory/)
			await expect(own.get('statement')).rejects.toThrow(/in memory/)
			await expect(
				ownConnectionFor(memory, { url: ':memory:' }, { warn }).get('transaction')
			).rejects.toThrow(/could lose the app's writes/)
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn.mock.calls[0]?.[0]).toMatch(
				/needs a SQLite connection of its own beside the app's, and cannot open one: the database is in memory/
			)
		} finally {
			await closeOwnConnection(memory)
			memory.close?.()
		}
		const opened = vi.fn()
		await expect(
			ownConnectionFor(host, { url }, { warn: opened }).get('transaction')
		).resolves.not.toBeNull()
		expect(opened).not.toHaveBeenCalled()
	})

	/** Node's own loading, with what `natives` reports after the load replaced by `after`. */
	const depsWith = (after: (before: string[]) => string[]): OwnConnectionDeps => {
		let loaded = false
		return {
			resolveClient: () => resolveLibsqlClient(process.cwd()),
			load: (path) => {
				loaded = true
				return createRequire(import.meta.url)(path)
			},
			natives: () => {
				const now = hostLibsqlNatives(process.cwd())
				return loaded ? after(now) : now
			},
		}
	}

	it('refuses a client that loaded another copy of libsql than the host’s', async () => {
		const deps = depsWith((now) => [...now, '/elsewhere/libsql.darwin-arm64.node'])
		await expect(ownConnectionFor(host, { url }, { deps }).get('transaction')).rejects.toThrow(
			/two copies in one process/
		)
	})

	it('refuses when @libsql/client cannot be resolved or exports no createClient', async () => {
		const missing: OwnConnectionDeps = {
			resolveClient: () => ({ failure: '@libsql/client could not be resolved from /nowhere' }),
			load: () => ({}),
			natives: () => [],
		}
		await expect(
			ownConnectionFor(host, { url }, { deps: missing }).get('transaction')
		).rejects.toThrow(/could not be resolved/)
		const empty: OwnConnectionDeps = { ...depsWith((now) => now), load: () => ({}) }
		await expect(ownConnectionFor(host, { url }, { deps: empty }).get('statement')).rejects.toThrow(
			/exports no createClient/
		)
	})
})
