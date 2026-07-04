import type { Payload } from 'payload'
import { ROLLUPS_SLUG } from '../collections/rollups'
import type { RollupKey, RollupMetric } from './deltas'

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

const ZERO: Record<RollupMetric, number> = {
	pageviews: 0,
	events: 0,
	durationMs: 0,
	samples: 0,
	visitors: 0,
	sessions: 0,
}

// Always seed every metric on insert: Payload's defaultValue is applied app-side, not as
// a SQL default, so a raw insert that omits a NOT NULL metric column would fail on Postgres.
export async function bumpRollup(
	payload: Payload,
	key: RollupKey,
	inc: Partial<Record<RollupMetric, number>>
): Promise<void> {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[ROLLUPS_SLUG]
		if (!model) throw new Error(`analytics: mongoose collection "${ROLLUPS_SLUG}" not found`)
		const setOnInsert: Record<string, unknown> = { ...key }
		for (const [metric, zero] of Object.entries(ZERO)) {
			if (!(metric in inc)) setOnInsert[metric] = zero
		}
		await model.collection.updateOne(
			key,
			{ $inc: inc, $setOnInsert: setOnInsert },
			{ upsert: true }
		)
		return
	}
	const { sql } = await import('@payloadcms/db-postgres')
	const db = payload.db as unknown as PgDb
	const tableName = db.tableNameMap.get(PG_TABLE_KEY)
	if (!tableName) throw new Error(`analytics: drizzle table "${PG_TABLE_KEY}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`analytics: drizzle table object for "${tableName}" not found`)
	const set: Record<string, unknown> = {}
	for (const [metric, amount] of Object.entries(inc)) {
		set[metric] = sql`${table[metric]} + ${amount}`
	}
	// The conflict target must match the unique index exactly, which includes the
	// scope column only in scoped installs (mirrored by a scope key on RollupKey).
	const target = [table.granularity, table.period, table.path, table.dimension, table.dimvalue]
	if (key.scope !== undefined) {
		target.push(table.scope)
	}
	await db.drizzle
		.insert(table)
		.values({ ...key, ...ZERO, ...inc })
		.onConflictDoUpdate({ target, set })
}
