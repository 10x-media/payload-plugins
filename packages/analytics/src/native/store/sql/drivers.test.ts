import { describe, expect, it, vi } from 'vitest'
import { SourceMisconfiguredError } from '../../../core/sourceErrors'
import {
	isLibsqlClient,
	isPgPool,
	type LibsqlClient,
	libsqlDriver,
	type OwnConnection,
	type PgPool,
	pgDriver,
	type TransactionOptions,
} from './drivers'

/** A pool that records every statement, on the pool itself or on the client it hands out. */
const fakePool = (options: { failRollback?: boolean } = {}) => {
	const log: string[] = []
	const release = vi.fn()
	const query = async (text: string, values: readonly unknown[]) => {
		log.push(values.length > 0 ? `${text} ${JSON.stringify(values)}` : text)
		if (text === 'ROLLBACK' && options.failRollback) {
			throw new Error('connection gone')
		}
		return { rows: [{ n: '2' }, 'not a row'], rowCount: 1 }
	}
	const pool: PgPool = {
		query: (text, values) => query(`pool: ${text}`, values),
		connect: async () => ({
			query: (text, values) => query(text, values),
			release,
		}),
	}
	return { pool, log, release }
}

describe('pgDriver', () => {
	const timeout = (options: TransactionOptions): string[] => [
		...(options.timeoutMs === undefined
			? []
			: [`SET LOCAL statement_timeout = ${options.timeoutMs}`]),
		...(options.lockTimeoutMs === undefined
			? []
			: [`SET LOCAL lock_timeout = ${options.lockTimeoutMs}`]),
	]

	it('runs a statement on the pool, keeping only rows that are rows', async () => {
		const { pool, log } = fakePool()
		const result = await pgDriver(pool, timeout).run('SELECT $1', ['a'])
		expect(log).toEqual(['pool: SELECT $1 ["a"]'])
		expect(result).toEqual({ rows: [{ n: '2' }], rowCount: 1 })
	})

	it('runs a transaction on one client: begin with the timeout, the work, commit, release', async () => {
		const { pool, log, release } = fakePool()
		const answer = await pgDriver(pool, timeout).transaction(
			async (session) => {
				await session.run('INSERT 1', [])
				return 'done'
			},
			{ timeoutMs: 2000 }
		)
		expect(answer).toBe('done')
		expect(log).toEqual(['BEGIN; SET LOCAL statement_timeout = 2000', 'INSERT 1', 'COMMIT'])
		expect(release).toHaveBeenCalledWith(false)
	})

	it('sends every setting the options ask for with BEGIN, in one round trip', async () => {
		const { pool, log } = fakePool()
		await pgDriver(pool, timeout).transaction(
			async (session) => {
				await session.run('UPDATE 1', [])
			},
			{ timeoutMs: 100, lockTimeoutMs: 200 }
		)
		// The statement gets what is left of 100 ms after the pool wait.
		const [begin, ...rest] = log
		const left = Number(/statement_timeout = (\d+);/.exec(begin ?? '')?.[1])
		expect(left).toBeGreaterThan(0)
		expect(left).toBeLessThanOrEqual(100)
		expect(begin).toMatch(
			/^BEGIN; SET LOCAL statement_timeout = \d+; SET LOCAL lock_timeout = 200$/
		)
		expect(rest).toEqual(['UPDATE 1', 'COMMIT'])
	})

	it('rolls back what failed, hands the client back and throws the work’s own error', async () => {
		const { pool, log, release } = fakePool()
		const failing = pgDriver(pool, timeout).transaction(async (session) => {
			await session.run('INSERT 1', [])
			throw new Error('work failed')
		}, {})
		await expect(failing).rejects.toThrow('work failed')
		expect(log).toEqual(['BEGIN', 'INSERT 1', 'ROLLBACK'])
		expect(release).toHaveBeenCalledWith(false)
	})

	it('destroys a client that could not even roll back', async () => {
		const { pool, release } = fakePool({ failRollback: true })
		const failing = pgDriver(pool, timeout).transaction(async () => {
			throw new Error('work failed')
		}, {})
		await expect(failing).rejects.toThrow('work failed')
		expect(release).toHaveBeenCalledWith(true)
	})

	it('runs a batch of one as a plain statement, and of several in one transaction', async () => {
		const { pool, log } = fakePool()
		const driver = pgDriver(pool, timeout)
		await driver.batch([{ text: 'INSERT 1', values: [] }])
		const { results } = await driver.batch([
			{ text: 'INSERT 2', values: ['a'] },
			{ text: 'INSERT 3', values: [] },
		])
		expect(results).toHaveLength(2)
		expect(log).toEqual(['pool: INSERT 1', 'BEGIN', 'INSERT 2 ["a"]', 'INSERT 3', 'COMMIT'])
	})

	it('recognizes a pool by its methods', () => {
		expect(isPgPool(fakePool().pool)).toBe(true)
		expect(isPgPool({ query: () => undefined })).toBe(false)
		expect(isPgPool(null)).toBe(false)
	})
})

/**
 * A libsql client recording statements in run order; `#db` is dropped once a transaction takes it,
 * so a call landing between the busy timeout and BEGIN would show up on a second connection.
 */
const fakeLibsql = (protocol = 'file') => {
	const log: string[] = []
	let connection = 1
	let opened = 1
	const tx = (on: number) => ({
		execute: async ({ sql }: { sql: string }) => {
			log.push(`#${on} ${sql}`)
			return { rows: [], rowsAffected: 1 }
		},
		commit: async () => {
			log.push(`#${on} COMMIT`)
		},
		rollback: async () => {
			log.push(`#${on} ROLLBACK`)
		},
		close: () => {
			log.push(`#${on} close`)
		},
	})
	const client: LibsqlClient = {
		protocol,
		batch: async (statements) => {
			log.push(`#${connection} BATCH ${statements.map((one) => one.sql).join('; ')}`)
			return statements.map(() => ({ rows: [], rowsAffected: 1 }))
		},
		execute: (statement) => {
			const text = typeof statement === 'string' ? statement : statement.sql
			log.push(`#${connection} ${text}`)
			return text.includes('BUSY')
				? Promise.reject(new Error('SQLITE_BUSY: database is locked'))
				: Promise.resolve({ rows: [{ a: 1 }], rowsAffected: 2 })
		},
		transaction: (mode) => {
			const on = connection
			log.push(`#${on} BEGIN ${mode}`)
			opened += 1
			connection = opened
			return Promise.resolve(tx(on))
		},
	}
	return { client, log }
}

describe('libsqlDriver', () => {
	it('sets the busy timeout on the connection a write is about to use, in the same tick', async () => {
		const { client, log } = fakeLibsql()
		const result = await libsqlDriver(client, 5000).write('INSERT 1', [])
		expect(log).toEqual(['#1 PRAGMA busy_timeout = 5000', '#1 INSERT 1'])
		expect(result).toEqual({ rows: [{ a: 1 }], rowCount: 2 })
	})

	it('sets it on the connection a transaction begins on, before BEGIN IMMEDIATE', async () => {
		const { client, log } = fakeLibsql()
		const driver = libsqlDriver(client, 5000)
		await driver.transaction(async (session) => {
			await session.run('INSERT 1', [])
		}, {})
		await driver.write('INSERT 2', [])
		expect(log).toEqual([
			'#1 PRAGMA busy_timeout = 5000',
			'#1 BEGIN write',
			'#1 INSERT 1',
			'#1 COMMIT',
			'#1 close',
			// libsql opens the next connection without the pragma, so the write sets it again.
			'#2 PRAGMA busy_timeout = 5000',
			'#2 INSERT 2',
		])
	})

	it('rolls a failed transaction back and throws the work’s own error', async () => {
		const { client, log } = fakeLibsql()
		const failing = libsqlDriver(client, 5000).transaction(async () => {
			throw new Error('work failed')
		}, {})
		await expect(failing).rejects.toThrow('work failed')
		expect(log).toEqual([
			'#1 PRAGMA busy_timeout = 5000',
			'#1 BEGIN write',
			'#1 ROLLBACK',
			'#1 close',
		])
	})

	it('queues this process’s own writes behind an open transaction instead of racing it', async () => {
		const { client, log } = fakeLibsql()
		const driver = libsqlDriver(client, 5000)
		let finish: () => void = () => undefined
		const held = new Promise<void>((resolve) => {
			finish = resolve
		})
		const transaction = driver.transaction(async (session) => {
			await session.run('INSERT in tx', [])
			await held
		}, {})
		const write = driver.write('INSERT outside', [])
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(log.some((line) => line.includes('INSERT outside'))).toBe(false)
		finish()
		await Promise.all([transaction, write])
		expect(log.indexOf('#1 COMMIT')).toBeLessThan(
			log.findIndex((line) => line.includes('INSERT outside'))
		)
	})

	it('never begins a transaction on the host’s client to put a failed statement aside', async () => {
		const { client, log } = fakeLibsql()
		const driver = libsqlDriver(client, 5000)
		await expect(driver.write('INSERT BUSY', [])).rejects.toThrow('SQLITE_BUSY')
		await driver.write('INSERT after', [])
		expect(log).toEqual([
			'#1 PRAGMA busy_timeout = 5000',
			'#1 INSERT BUSY',
			'#1 PRAGMA busy_timeout = 5000',
			'#1 INSERT after',
		])
	})

	it('runs a batch on the connection the busy timeout was just set on, queued like a write', async () => {
		const { client, log } = fakeLibsql()
		const { results } = await libsqlDriver(client, 5000).batch([
			{ text: 'INSERT 1', values: [] },
			{ text: 'INSERT 2', values: [] },
		])
		expect(results).toEqual([
			{ rows: [], rowCount: 1 },
			{ rows: [], rowCount: 1 },
		])
		expect(log).toEqual(['#1 PRAGMA busy_timeout = 5000', '#1 BATCH INSERT 1; INSERT 2'])
	})

	it('runs a batch expecting row counts in a transaction, rolled back at the first other count', async () => {
		const { client, log } = fakeLibsql()
		const outcome = await libsqlDriver(client, 5000).batch([
			{ text: 'UPDATE fence', values: [], expect: 1 },
			{ text: 'INSERT rows', values: [] },
			{ text: 'UPDATE complete', values: [], expect: 2 },
			{ text: 'never', values: [] },
		])
		expect(outcome).toMatchObject({ committed: false, failedAt: 2 })
		expect(log).toEqual([
			'#1 PRAGMA busy_timeout = 5000',
			'#1 BEGIN write',
			'#1 UPDATE fence',
			'#1 INSERT rows',
			'#1 UPDATE complete',
			'#1 ROLLBACK',
			'#1 close',
		])
	})

	it('sends no pragma to a remote database, which has its own locking', async () => {
		const { client, log } = fakeLibsql('https')
		await libsqlDriver(client, 5000).write('INSERT 1', [])
		expect(log).toEqual(['#1 INSERT 1'])
	})

	it('reads without waiting for any write', async () => {
		const { client, log } = fakeLibsql()
		const result = await libsqlDriver(client, 5000).run('SELECT 1', [])
		expect(log).toEqual(['#1 SELECT 1'])
		expect(result.rows).toEqual([{ a: 1 }])
	})

	it('recognizes a libsql client by its methods', () => {
		expect(isLibsqlClient(fakeLibsql().client)).toBe(true)
		expect(isLibsqlClient(fakePool().pool)).toBe(false)
	})
})

/** An own connection that records its statements beside the host's, failing any naming FAIL. */
const fakeOwn = (log: string[], available = true) => {
	const discarded: LibsqlClient[] = []
	const connection: LibsqlClient = {
		protocol: 'file',
		batch: async () => [],
		transaction: () => Promise.reject(new Error('never on the own connection')),
		execute: (statement) => {
			const text = typeof statement === 'string' ? statement : statement.sql
			log.push(`own ${text}`)
			return text.includes('FAIL')
				? Promise.reject(new Error('SQLITE_BUSY: database is locked'))
				: Promise.resolve({ rows: [], rowsAffected: 1 })
		},
	}
	const own: OwnConnection = {
		get: async (_role) => {
			if (!available) {
				throw new SourceMisconfiguredError('analytics: no connection of its own')
			}
			return connection
		},
		discard: (each) => {
			discarded.push(each)
		},
	}
	return { own, connection, discarded }
}

describe('libsqlDriver on a connection of its own', () => {
	it('runs a transaction there, never handing the host’s connection away', async () => {
		const { client, log } = fakeLibsql()
		const { own, discarded } = fakeOwn(log)
		const driver = libsqlDriver(client, 5000, { own })
		await driver.transaction(async (session) => {
			await session.run('INSERT 1', [])
		}, {})
		await driver.transaction(async (session) => {
			await session.run('INSERT 2', [])
		}, {})
		await driver.write('INSERT 3', [])
		await driver.run('SELECT 4', [])
		expect(log).toEqual([
			'own PRAGMA busy_timeout = 5000',
			'own BEGIN IMMEDIATE',
			'own INSERT 1',
			'own COMMIT',
			'own PRAGMA busy_timeout = 5000',
			'own BEGIN IMMEDIATE',
			'own INSERT 2',
			'own COMMIT',
			'own PRAGMA busy_timeout = 5000',
			'own INSERT 3',
			'own SELECT 4',
		])
		expect(discarded).toEqual([])
	})

	it('keeps a connection after a failure that leaves it able to commit', async () => {
		const { client, log } = fakeLibsql()
		const { own, connection, discarded } = fakeOwn(log)
		const failing = vi.spyOn(connection, 'execute')
		failing.mockRejectedValueOnce(
			Object.assign(new Error('no such table: gone'), { code: 'SQLITE_ERROR' })
		)
		const driver = libsqlDriver(client, 5000, { own })
		await expect(driver.run('SELECT * FROM gone', [])).rejects.toThrow('no such table')
		await expect(
			driver.transaction(async (session) => {
				await session.run('INSERT FAIL', [])
			}, {})
		).rejects.toThrow('SQLITE_BUSY')
		expect(discarded).toEqual([connection])
		const unique = Object.assign(new Error('UNIQUE constraint failed: t.id'), {
			code: 'SQLITE_CONSTRAINT_UNIQUE',
		})
		failing.mockRejectedValueOnce(unique)
		await expect(driver.write('INSERT dup', [])).rejects.toBe(unique)
		expect(discarded).toEqual([connection])
	})

	it('runs single statements on a connection apart from the transactions’ one', async () => {
		const { client, log } = fakeLibsql()
		const roles: string[] = []
		const { connection } = fakeOwn(log)
		const own: OwnConnection = {
			get: async (role) => {
				roles.push(role)
				return connection
			},
			discard: () => undefined,
		}
		const driver = libsqlDriver(client, 5000, { own })
		await driver.run('SELECT 1', [])
		await driver.write('INSERT 2', [])
		await driver.batch([{ text: 'INSERT 3', values: [] }])
		await driver.transaction(async (session) => {
			await session.run('INSERT 4', [])
		}, {})
		expect(roles).toEqual(['statement', 'statement', 'statement', 'transaction'])
		expect(log.filter((line) => line.startsWith('#'))).toEqual([])
	})

	it('closes the statement connection a statement failed on, and opens a fresh one after', async () => {
		const { client, log } = fakeLibsql()
		const opened: LibsqlClient[] = []
		const closed: LibsqlClient[] = []
		let current: LibsqlClient | undefined
		const fresh = (): LibsqlClient => {
			const index = opened.length + 1
			const connection: LibsqlClient = {
				protocol: 'file',
				batch: async () => [],
				transaction: () => Promise.reject(new Error('never on the own connection')),
				execute: (statement) => {
					const text = typeof statement === 'string' ? statement : statement.sql
					log.push(`own${index} ${text}`)
					return text.includes('BUSY')
						? Promise.reject(new Error('SQLITE_BUSY: database is locked'))
						: Promise.resolve({ rows: [], rowsAffected: 1 })
				},
			}
			opened.push(connection)
			return connection
		}
		const own: OwnConnection = {
			get: async () => {
				current ??= fresh()
				return current
			},
			discard: (connection) => {
				closed.push(connection)
				current = undefined
			},
		}
		const driver = libsqlDriver(client, 5000, { own })
		await expect(driver.write('INSERT BUSY', [])).rejects.toThrow('SQLITE_BUSY')
		await driver.write('INSERT after', [])
		expect(log).toEqual([
			'own1 PRAGMA busy_timeout = 5000',
			'own1 INSERT BUSY',
			'own2 PRAGMA busy_timeout = 5000',
			'own2 INSERT after',
		])
		expect(closed).toEqual([opened[0]])
	})

	it('rolls back a batch at a count it did not expect and keeps the connection', async () => {
		const { client, log } = fakeLibsql()
		const { own, discarded } = fakeOwn(log)
		const outcome = await libsqlDriver(client, 5000, { own }).batch([
			{ text: 'UPDATE fence', values: [], expect: 2 },
			{ text: 'never', values: [] },
		])
		expect(outcome).toMatchObject({ committed: false, failedAt: 0 })
		expect(log).toEqual([
			'own PRAGMA busy_timeout = 5000',
			'own BEGIN IMMEDIATE',
			'own UPDATE fence',
			'own ROLLBACK',
		])
		expect(discarded).toEqual([])
	})

	it('lets go of the connection a statement failed on', async () => {
		const { client, log } = fakeLibsql()
		const { own, connection, discarded } = fakeOwn(log)
		const failing = libsqlDriver(client, 5000, { own }).transaction(async (session) => {
			await session.run('INSERT FAIL', [])
		}, {})
		await expect(failing).rejects.toThrow('SQLITE_BUSY')
		expect(log.slice(-2)).toEqual(['own INSERT FAIL', 'own ROLLBACK'])
		expect(discarded).toEqual([connection])
	})

	it('keeps the connection when the work itself throws', async () => {
		const { client, log } = fakeLibsql()
		const { own, discarded } = fakeOwn(log)
		const failing = libsqlDriver(client, 5000, { own }).transaction(async () => {
			throw new Error('work failed')
		}, {})
		await expect(failing).rejects.toThrow('work failed')
		expect(log.at(-1)).toBe('own ROLLBACK')
		expect(discarded).toEqual([])
	})

	it("fails loudly where it can have no second one, never falling back to the host's client", async () => {
		const { client, log } = fakeLibsql()
		const { own } = fakeOwn(log, false)
		const driver = libsqlDriver(client, 5000, { own })
		await expect(
			driver.transaction(async (session) => {
				await session.run('INSERT 1', [])
			}, {})
		).rejects.toBeInstanceOf(SourceMisconfiguredError)
		await expect(driver.write('INSERT 2', [])).rejects.toBeInstanceOf(SourceMisconfiguredError)
		await expect(driver.run('SELECT 3', [])).rejects.toBeInstanceOf(SourceMisconfiguredError)
		expect(log).toEqual([])
	})
})
