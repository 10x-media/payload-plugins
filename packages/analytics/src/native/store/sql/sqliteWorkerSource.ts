/**
 * The SQLite worker thread's program, CommonJS run with `eval: true` so no file of its own has to
 * survive a bundler. It answers one message at a time, each statement running to its end there.
 * It can import nothing of this package: `natives` and `lockFailure` repeat `hostLibsqlNatives`
 * and `isSqliteLockFailure`, and change with them.
 */
export const SQLITE_WORKER_SOURCE = `'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const { realpathSync } = require('node:fs')
const { clientPath, config, busyTimeoutMs } = workerData
const pragma = 'PRAGMA busy_timeout = ' + busyTimeoutMs
const transactions = new Map()
const staged = new Map()
let nextTransaction = 0
let libsql
let client
let failure

const plain = (result) => {
	const columns = result.columns
	const rows = new Array(result.rows.length)
	for (let r = 0; r < result.rows.length; r++) {
		const row = result.rows[r]
		const out = {}
		for (let c = 0; c < columns.length; c++) {
			out[columns[c]] = row[c]
		}
		rows[r] = out
	}
	return { rows, rowCount: result.rowsAffected }
}

const FIELDS = ['name', 'message', 'code', 'rawCode', 'extendedCode']

const described = (error, depth) => {
	if (typeof error !== 'object' || error === null) {
		return { name: 'Error', message: String(error) }
	}
	const out = {}
	for (const field of FIELDS) {
		const value = error[field]
		if (typeof value === 'string' || typeof value === 'number') {
			out[field] = value
		}
	}
	if (depth < 4 && error.cause !== undefined && error.cause !== error) {
		out.cause = described(error.cause, depth + 1)
	}
	return out
}

const realpath = (path) => {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

const natives = () =>
	Object.keys(require.cache)
		.filter((key) => key.endsWith('.node') && key.includes('libsql'))
		.map(realpath)

const opened = () => {
	if (!client) {
		throw new Error('analytics: the SQLite worker thread could not open the database: ' + failure)
	}
	return client
}

// A statement refused for a lock (SQLITE_BUSY, SQLITE_LOCKED) is the one failure libsql leaves
// running on its connection, after which nothing on that connection commits.
const lockFailure = (error) => {
	for (let level = error, depth = 0; level && typeof level === 'object' && depth < 8; level = level.cause, depth++) {
		for (const key of ['code', 'extendedCode', 'message']) {
			const value = level[key]
			if (typeof value === 'string' && (value.startsWith('SQLITE_BUSY') || value.startsWith('SQLITE_LOCKED'))) {
				return true
			}
		}
	}
	return false
}

// The client is this thread's own, so after a lock failure it is closed and opened afresh; a
// transaction would hand its connection over and never close it. Any other failure keeps it, since
// a replaced connection keeps its descriptor open while the file is.
const replace = async (failed) => {
	if (!failed || client !== failed) {
		return
	}
	try {
		client = libsql.createClient(config)
		await client.execute(pragma)
	} catch (error) {
		failure = String(error && error.message ? error.message : error)
		client = undefined
	}
	try {
		failed.close()
	} catch {}
}

const onShared = async (attempt) => {
	const used = client
	try {
		return await attempt()
	} catch (error) {
		if (lockFailure(error)) {
			await replace(used)
		}
		throw error
	}
}

// Both calls run synchronously, so the timeout lands on the connection the work is about to use.
const afterPragma = async (work) => {
	const [, result] = await Promise.all([opened().execute(pragma), work()])
	return result
}

const statementOf = (message) => ({ sql: message.sql, args: message.args })

// libsql's transaction() hands the client's connection to the transaction and never closes it, so
// transactions run on connections of this thread's own instead, kept between them.
const spare = []

const letGo = (open) => {
	if (open.failed || spare.length > 0 || !client) {
		open.connection.close()
	} else {
		spare.push(open.connection)
	}
}

// A write transaction begun on a kept connection; one a statement failed on is never kept.
const beginOwn = async () => {
	opened()
	const open = { connection: spare.pop() ?? libsql.createClient(config), failed: false }
	open.execute = async (statement) => {
		try {
			return await open.connection.execute(statement)
		} catch (error) {
			open.failed = open.failed || lockFailure(error)
			throw error
		}
	}
	try {
		await open.execute(pragma)
		await open.execute('BEGIN IMMEDIATE')
	} catch (error) {
		letGo(open)
		throw error
	}
	return open
}

const rollBack = (open) =>
	open.connection.execute('ROLLBACK').then(
		() => undefined,
		() => {
			open.failed = true
		}
	)

const heldOf = (id) => {
	const held = transactions.get(id)
	if (!held) {
		throw new Error('analytics: the SQLite transaction is gone: it idled past its limit, or its thread restarted')
	}
	return held
}

const end = async (id, how) => {
	const held = transactions.get(id)
	if (!held) {
		if (how === 'rollback') {
			return null
		}
		heldOf(id)
	}
	transactions.delete(id)
	clearTimeout(held.timer)
	try {
		if (how === 'commit') {
			await held.open.execute('COMMIT').catch(async (error) => {
				await rollBack(held.open)
				throw error
			})
		} else {
			await rollBack(held.open)
		}
	} finally {
		letGo(held.open)
	}
	return null
}

const touch = (id, held) => {
	clearTimeout(held.timer)
	held.timer = setTimeout(() => {
		void end(id, 'rollback')
	}, held.idleMs)
	held.timer.unref()
}

const handlers = {
	execute: (message) => onShared(async () => plain(await opened().execute(statementOf(message)))),
	write: (message) =>
		onShared(async () => plain(await afterPragma(() => client.execute(statementOf(message))))),
	stage: (message) => {
		const held = staged.get(message.batch) ?? []
		staged.set(message.batch, held.concat(message.statements))
		return null
	},
	// A batch runs here whole: its lock is never held while it waits on the main thread, where a
	// host write may be blocked on that very lock.
	batch: async (message) => {
		let statements = message.statements
		if (message.staged !== undefined) {
			const held = staged.get(message.staged)
			if (!held) {
				throw new Error('analytics: the staged statements of a batch are gone: its thread restarted')
			}
			staged.delete(message.staged)
			statements = held.concat(statements)
		}
		if (!statements.some((each) => each.expect !== undefined)) {
			return onShared(async () => {
				const results = await afterPragma(() => client.batch(statements.map(statementOf), 'write'))
				return { committed: true, results: results.map(plain) }
			})
		}
		const open = await beginOwn()
		const results = []
		try {
			for (let index = 0; index < statements.length; index++) {
				const each = statements[index]
				const result = plain(await open.execute(statementOf(each)))
				results.push(result)
				if (each.expect !== undefined && result.rowCount !== each.expect) {
					await open.execute('ROLLBACK')
					return { committed: false, failedAt: index, results }
				}
			}
			await open.execute('COMMIT')
			return { committed: true, results }
		} catch (error) {
			await rollBack(open)
			throw error
		} finally {
			letGo(open)
		}
	},
	begin: async (message) => {
		const open = await beginOwn()
		nextTransaction += 1
		const held = { open, timer: undefined, idleMs: message.idleMs }
		transactions.set(nextTransaction, held)
		touch(nextTransaction, held)
		return nextTransaction
	},
	tx: async (message) => {
		const held = heldOf(message.tx)
		touch(message.tx, held)
		return plain(await held.open.execute(statementOf(message)))
	},
	commit: (message) => end(message.tx, 'commit'),
	rollback: (message) => end(message.tx, 'rollback'),
	close: async () => {
		for (const id of [...transactions.keys()]) {
			await end(id, 'rollback')
		}
		staged.clear()
		client?.close()
		client = undefined
		failure = 'it was closed'
		for (const connection of spare.splice(0)) {
			connection.close()
		}
		return null
	},
}

const reply = (message) => {
	try {
		parentPort.postMessage(message)
	} catch (error) {
		parentPort.postMessage({ id: message.id, ok: false, error: described(error, 0) })
	}
}

// A big answer goes in parts, so the main thread clones each in a slice of its own.
const ROWS_PER_MESSAGE = 5000

const answer = (id, value) => {
	const rows = value && Array.isArray(value.rows) ? value.rows : null
	if (!rows || rows.length <= ROWS_PER_MESSAGE) {
		reply({ id, ok: true, value })
		return
	}
	let start = 0
	for (; start + ROWS_PER_MESSAGE < rows.length; start += ROWS_PER_MESSAGE) {
		parentPort.postMessage({ id, rows: rows.slice(start, start + ROWS_PER_MESSAGE) })
	}
	reply({ id, ok: true, value: { ...value, rows: rows.slice(start) } })
}

parentPort.on('message', (message) => {
	const handler = handlers[message.op]
	Promise.resolve()
		.then(() => {
			if (!handler) {
				throw new Error('analytics: the SQLite worker thread has no "' + message.op + '" operation')
			}
			return handler(message)
		})
		.then(
			(value) => answer(message.id, value),
			(error) => reply({ id: message.id, ok: false, error: described(error, 0) })
		)
})

const start = async () => {
	libsql = require(clientPath)
	client = libsql.createClient(config)
	await client.execute(pragma)
	const mode = await client.execute('PRAGMA journal_mode')
	const first = mode.rows[0]
	return { journalMode: first ? String(first[0]) : null, natives: natives() }
}

start().then(
	(ready) => parentPort.postMessage({ ready }),
	(error) => {
		failure = String(error && error.message ? error.message : error)
		client = undefined
		parentPort.postMessage({ failed: described(error, 0) })
	}
)
`
