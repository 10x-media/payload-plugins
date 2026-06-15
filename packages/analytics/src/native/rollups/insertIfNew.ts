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

// Returns true iff the row was newly inserted (the key had not been seen). Single-statement
// atomic on both adapters; the unique index on `slug` is what makes it concurrency-safe.
export async function insertIfNew(
	payload: Payload,
	slug: string,
	key: Record<string, unknown>
): Promise<boolean> {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[slug]
		if (!model) throw new Error(`analytics: mongoose collection "${slug}" not found`)
		const res = await model.collection.updateOne(key, { $setOnInsert: key }, { upsert: true })
		return res.upsertedCount === 1
	}
	const db = payload.db as unknown as PgDb
	const tableKey = slug.replace(/-/g, '_')
	const tableName = db.tableNameMap.get(tableKey)
	if (!tableName) throw new Error(`analytics: drizzle table "${tableKey}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`analytics: drizzle table object for "${tableName}" not found`)
	const inserted = await db.drizzle.insert(table).values(key).onConflictDoNothing().returning()
	return inserted.length === 1
}
