import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { type SQLiteAdapter, sqliteAdapter } from '@payloadcms/db-sqlite'
import type { CollectionConfig, Payload, Plugin } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type BootedPayload, bootPayload } from '../src/bootPayload'
import { keepBusyTimeout, SQLITE_TEST_BUSY_TIMEOUT_MS } from '../src/db/sqlite'
import { expectForDb } from '../src/describeForDb'

const passthroughPlugin: Plugin = (incoming) => incoming

const notes: CollectionConfig = { slug: 'notes', fields: [{ name: 'title', type: 'text' }] }

const fileOf = (booted: BootedPayload): string => booted.connectionString.slice('file:'.length)

describe('bootPayload [db=sqlite]', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: passthroughPlugin, db: 'sqlite', collections: [notes] })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('boots on a temp file of its own', () => {
		expect(booted.db).toBe('sqlite')
		expect(booted.mode).toBe('file')
		expect(booted.payload.db.name).toBe('sqlite')
		expect(existsSync(fileOf(booted))).toBe(true)
	})

	it('lets a second instance attached to the same file read and write it', async () => {
		const created = await booted.payload.create({ collection: 'notes', data: { title: 'first' } })
		const attached = await bootPayload({
			plugin: passthroughPlugin,
			db: 'sqlite',
			collections: [notes],
			attachTo: booted,
		})
		try {
			expect(attached.connectionString).toBe(booted.connectionString)
			const found = await attached.payload.findByID({ collection: 'notes', id: created.id })
			expect(found.title).toBe('first')
			await attached.payload.create({ collection: 'notes', data: { title: 'second' } })
			expect((await booted.payload.count({ collection: 'notes' })).totalDocs).toBe(2)
		} finally {
			await attached.stop()
		}
		// Stopping the attached instance leaves the owner's file in place.
		expect(existsSync(fileOf(booted))).toBe(true)
		expect((await booted.payload.count({ collection: 'notes' })).totalDocs).toBe(2)
	})

	it('refuses to attach a boot to another kind of database', async () => {
		await expect(
			bootPayload({ plugin: passthroughPlugin, db: 'postgres', attachTo: booted })
		).rejects.toThrow('cannot attach a postgres boot to a sqlite database')
	})
})

describe('bootPayload options', () => {
	it('skips every onInit when disableOnInit is set, as a jobs worker boots', async () => {
		const ran: string[] = []
		const plugin: Plugin = (config) => ({
			...config,
			onInit: async () => {
				ran.push('onInit')
			},
		})
		const worker = await bootPayload({ plugin, db: 'sqlite', disableOnInit: true })
		const regular = await bootPayload({ plugin, db: 'sqlite' })
		try {
			expect(ran).toEqual(['onInit'])
		} finally {
			await worker.stop()
			await regular.stop()
		}
	})

	it('removes the database directory on stop', async () => {
		const temporary = await bootPayload({ plugin: passthroughPlugin, db: 'sqlite' })
		const dir = dirname(fileOf(temporary))
		expect(existsSync(dir)).toBe(true)
		await temporary.stop()
		expect(existsSync(dir)).toBe(false)
	})

	it('closes the connection and removes the database of a boot that fails', async () => {
		let opened: { file: string; client: OpenedClient } | undefined
		const failing: Plugin = (config) => ({
			...config,
			onInit: async (payload) => {
				opened = openedConnection(payload.db)
				throw new Error('onInit failed on purpose')
			},
		})
		await expect(bootPayload({ plugin: failing, db: 'sqlite' })).rejects.toThrow(
			'onInit failed on purpose'
		)
		expect(opened?.client.closed).toBe(true)
		expect(existsSync(dirname(opened?.file ?? ''))).toBe(false)
	})
})

/** The libsql client of a SQLite adapter, read structurally. */
interface OpenedClient {
	closed: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/** Where a SQLite adapter's database file lives, and its client. */
const openedConnection = (db: unknown): { file: string; client: OpenedClient } => {
	const config = isRecord(db) ? db.clientConfig : undefined
	const url = isRecord(config) ? config.url : undefined
	const client = isRecord(db) ? db.client : undefined
	if (typeof url !== 'string' || !isRecord(client) || typeof client.closed !== 'boolean') {
		throw new Error('not a libsql SQLite adapter')
	}
	return {
		file: url.slice('file:'.length),
		client: {
			get closed() {
				return client.closed === true
			},
		},
	}
}

type LibsqlClient = SQLiteAdapter['client']

const isLibsqlClient = (value: unknown): value is LibsqlClient =>
	isRecord(value) &&
	typeof value.transaction === 'function' &&
	typeof value.execute === 'function' &&
	value.protocol === 'file'

const libsqlClientOf = (payload: Payload): LibsqlClient => {
	const client: unknown = Reflect.get(payload.db, 'client')
	if (!isLibsqlClient(client)) {
		throw new Error('not a local libsql client')
	}
	return client
}

/** The busy timeout of the connection the client's next statement runs on. */
const busyTimeoutOf = async (client: LibsqlClient): Promise<unknown> =>
	(await client.execute('PRAGMA busy_timeout')).rows[0]?.timeout

/** A short timeout of the plain adapter's own, so waiting it out costs the test little. */
const PLAIN_TIMEOUT_MS = 300

describe('busy timeout on the connections a libsql transaction hands over [db=sqlite]', () => {
	let owner: BootedPayload
	let plain: BootedPayload

	beforeAll(async () => {
		owner = await bootPayload({ plugin: passthroughPlugin, db: 'sqlite', collections: [notes] })
		// Payload's own adapter, as a host configures it, with nothing of the harness on its client.
		plain = await bootPayload({
			plugin: passthroughPlugin,
			db: 'sqlite',
			collections: [notes],
			attachTo: owner,
			configOverrides: {
				db: sqliteAdapter({
					client: { url: owner.connectionString },
					wal: true,
					busyTimeout: PLAIN_TIMEOUT_MS,
				}),
			},
		})
	})

	afterAll(async () => {
		await plain?.stop()
		await owner?.stop()
	})

	it('leaves the connection after a transaction without it on the plain Payload adapter', async () => {
		const client = libsqlClientOf(plain.payload)
		expect(await busyTimeoutOf(client)).toBe(PLAIN_TIMEOUT_MS)
		const tx = await client.transaction('write')
		await tx.commit()
		tx.close()
		expect(await busyTimeoutOf(client)).toBe(0)
	})

	it('fails a second transaction at once while the first holds the lock, without the fix', async () => {
		const client = libsqlClientOf(plain.payload)
		const holder = await client.transaction('write')
		try {
			const started = performance.now()
			await expect(client.transaction('write')).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
			expect(performance.now() - started).toBeLessThan(PLAIN_TIMEOUT_MS / 2)
		} finally {
			await holder.rollback()
			holder.close()
		}
	})

	it('makes the second transaction wait out the busy timeout once the fix is on', async () => {
		const client = libsqlClientOf(plain.payload)
		keepBusyTimeout(client, PLAIN_TIMEOUT_MS)
		const holder = await client.transaction('write')
		try {
			expect(await busyTimeoutOf(client)).toBe(PLAIN_TIMEOUT_MS)
			const started = performance.now()
			await expect(client.transaction('write')).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
			expect(performance.now() - started).toBeGreaterThanOrEqual(PLAIN_TIMEOUT_MS * 0.8)
		} finally {
			await holder.rollback()
			holder.close()
		}
	})

	it('keeps the harness timeout on every connection its transactions hand over', async () => {
		const client = libsqlClientOf(owner.payload)
		for (let i = 0; i < 3; i++) {
			const tx = await client.transaction('write')
			await tx.commit()
			tx.close()
			expect(await busyTimeoutOf(client)).toBe(SQLITE_TEST_BUSY_TIMEOUT_MS)
		}
	})
})

describe('expectForDb', () => {
	it('answers from the named adapters and falls back for the rest', () => {
		expect(expectForDb('postgres', { postgres: 'fk' }, 'none')).toBe('fk')
		expect(expectForDb('sqlite', { postgres: 'fk' }, 'none')).toBe('none')
		expect(expectForDb('mongo', { mongo: 1, postgres: 2 })).toBe(1)
	})

	it('throws for an adapter with neither an expectation nor a fallback', () => {
		expect(() => expectForDb('sqlite', { mongo: 1, postgres: 2 })).toThrow(
			'missing expectation for db=sqlite'
		)
	})
})
