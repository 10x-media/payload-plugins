import type { Payload } from 'payload'
import { ROLLUPS_SLUG } from '../collections/rollups'
import type { RollupDelta } from './deltas'

const PG_TABLE_KEY = 'analytics_rollups'

// payload.db raw-access shapes are intentionally loose; these narrow casts reach the
// Mongoose driver collection / Drizzle instance for atomic upserts (no public typed API).
type MongoDb = {
	name: 'mongoose'
	collections: Record<
		string,
		{ collection: { updateOne: (f: object, u: object, o: object) => Promise<unknown> } }
	>
}
type PgDb = {
	name: 'postgres'
	drizzle: {
		insert: (t: unknown) => {
			values: (v: unknown) => { onConflictDoUpdate: (c: unknown) => Promise<unknown> }
		}
	}
	tables: Record<string, Record<string, unknown>>
	tableNameMap: Map<string, string>
}

export async function applyRollupDeltas(payload: Payload, deltas: RollupDelta[]): Promise<void> {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[ROLLUPS_SLUG]
		if (!model) throw new Error(`analytics: mongoose collection "${ROLLUPS_SLUG}" not found`)
		for (const d of deltas) {
			await model.collection.updateOne(
				d.key,
				{ $inc: d.inc, $setOnInsert: { ...d.key } },
				{ upsert: true }
			)
		}
		return
	}
	const { sql } = await import('@payloadcms/db-postgres')
	const db = payload.db as unknown as PgDb
	const tableName = db.tableNameMap.get(PG_TABLE_KEY)
	if (!tableName) throw new Error(`analytics: drizzle table "${PG_TABLE_KEY}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`analytics: drizzle table object for "${tableName}" not found`)
	for (const d of deltas) {
		const set: Record<string, unknown> = {}
		for (const [col, amount] of Object.entries(d.inc)) {
			set[col] = sql`${table[col]} + ${amount}`
		}
		await db.drizzle
			.insert(table)
			.values({ ...d.key, ...d.inc })
			.onConflictDoUpdate({
				target: [table.granularity, table.period, table.path, table.dimension, table.dimvalue],
				set,
			})
	}
}
