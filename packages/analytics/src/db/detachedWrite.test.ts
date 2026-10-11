import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { exclusive } from '../native/store/sql/drivers'
import { detachedWrite, sqliteTransactionsNotice } from './detachedWrite'

const libsql = (protocol = 'file') => ({
	protocol,
	execute: vi.fn(async () => ({ rows: [], rowsAffected: 0, columns: [] })),
	batch: vi.fn(),
	transaction: vi.fn(),
})

const sqlite = (db: Record<string, unknown>) =>
	({ db: { name: 'sqlite', ...db } }) as unknown as Payload

describe('detachedWrite', () => {
	it('writes at once on a database the engine runs no local SQLite file on', async () => {
		const work = vi.fn(async () => 'written')
		const postgres = { db: { name: 'postgres', sessions: { open: {} } } } as unknown as Payload
		expect(await detachedWrite(postgres, work, 'skipped')).toBe('written')
		const remote = sqlite({ client: libsql('libsql'), sessions: { open: {} } })
		expect(await detachedWrite(remote, work, 'skipped')).toBe('written')
	})

	it("waits behind the engine's writes in this process, putting the busy timeout back first", async () => {
		const client = libsql()
		const order: string[] = []
		let release = (): void => undefined
		const engine = exclusive(
			client,
			() =>
				new Promise<void>((resolve) => {
					release = () => {
						order.push('engine')
						resolve()
					}
				})
		)
		const write = detachedWrite(
			sqlite({ client, sessions: {}, busyTimeout: 5000 }),
			async () => {
				order.push('cache')
				return 1
			},
			0
		)
		await Promise.resolve()
		expect(order).toEqual([])
		release()
		await engine
		expect(await write).toBe(1)
		expect(order).toEqual(['engine', 'cache'])
		expect(client.execute).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000')
	})

	it('is skipped while a transaction the host began is open, and sets no timeout of its own', async () => {
		const client = libsql()
		const work = vi.fn(async () => 1)
		const open = sqlite({ client, sessions: { 'tx-1': {} }, busyTimeout: 5000 })
		expect(await detachedWrite(open, work, 0)).toBe(0)
		expect(work).not.toHaveBeenCalled()
		const noTimeout = sqlite({ client, sessions: {}, busyTimeout: 0 })
		expect(await detachedWrite(noTimeout, work, 0)).toBe(1)
		expect(client.execute).not.toHaveBeenCalled()
	})
})

describe('sqliteTransactionsNotice', () => {
	it('speaks up for a local SQLite file whose adapter sets transactionOptions, and only then', () => {
		expect(sqliteTransactionsNotice(sqlite({ client: libsql(), transactionOptions: {} }))).toMatch(
			/transactionOptions.*busyTimeout.*SQLITE_BUSY/
		)
		expect(sqliteTransactionsNotice(sqlite({ client: libsql() }))).toBeNull()
		expect(
			sqliteTransactionsNotice(sqlite({ client: libsql('libsql'), transactionOptions: {} }))
		).toBeNull()
		expect(
			sqliteTransactionsNotice({ db: { name: 'postgres', transactionOptions: {} } } as never)
		).toBeNull()
	})
})
