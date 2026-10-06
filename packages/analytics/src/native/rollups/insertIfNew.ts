import type { Payload } from 'payload'

// payload.db raw-access shapes are intentionally loose; these narrow casts reach the
// Mongoose driver collection / Drizzle instance directly (no public typed API).
type MongoDb = {
	name: 'mongoose'
	collections: Record<
		string,
		{
			collection: {
				updateOne: (f: object, u: object, o: object) => Promise<{ upsertedCount: number }>
			}
		}
	>
}
type PgDb = {
	name: 'postgres'
	drizzle: {
		insert: (t: unknown) => {
			values: (v: unknown) => { onConflictDoNothing: () => { returning: () => Promise<unknown[]> } }
		}
	}
	tables: Record<string, Record<string, unknown>>
	tableNameMap: Map<string, string>
}

/** Mongo duplicate key. */
const MONGO_DUPLICATE = 11000
/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = '23505'

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` and Mongoose can wrap a write error in
 * turn, so the cause chain is walked rather than only the error handed to the catch.
 */
const isDuplicateKeyError = (err: unknown, code: number | string): boolean => {
	let current: unknown = err
	for (let depth = 0; depth < 4; depth++) {
		if (typeof current !== 'object' || current === null) {
			return false
		}
		if ((current as { code?: unknown }).code === code) {
			return true
		}
		current = (current as { cause?: unknown }).cause
	}
	return false
}

/**
 * Returns true iff the row was newly inserted (the key had not been seen). Single statement on
 * both adapters, and the unique index on the key is what makes it concurrency-safe: two writers
 * racing the same key means one of them loses, either quietly (no upsert, no insert) or with a
 * duplicate-key error the driver raises after the index rejects its write. Both outcomes mean
 * "already seen", so the error is caught here rather than escaping into the ingest response.
 *
 * Superseded on the write path by the batched `insertManyIfNew`, and kept as the serial
 * reference the matrix parity test replays a whole flush through.
 */
export async function insertIfNew(
	payload: Payload,
	slug: string,
	key: Record<string, unknown>
): Promise<boolean> {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[slug]
		if (!model) throw new Error(`analytics: mongoose collection "${slug}" not found`)
		try {
			const res = await model.collection.updateOne(key, { $setOnInsert: key }, { upsert: true })
			return res.upsertedCount === 1
		} catch (err) {
			if (isDuplicateKeyError(err, MONGO_DUPLICATE)) return false
			throw err
		}
	}
	const db = payload.db as unknown as PgDb
	const tableKey = slug.replace(/-/g, '_')
	const tableName = db.tableNameMap.get(tableKey)
	if (!tableName) throw new Error(`analytics: drizzle table "${tableKey}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`analytics: drizzle table object for "${tableName}" not found`)
	try {
		const inserted = await db.drizzle.insert(table).values(key).onConflictDoNothing().returning()
		return inserted.length === 1
	} catch (err) {
		if (isDuplicateKeyError(err, PG_UNIQUE_VIOLATION)) return false
		throw err
	}
}
