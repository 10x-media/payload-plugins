import type { Payload } from 'payload'
import { POLL_VOTES_SLUG, VOTE_SHARDS } from './votesCollection'

const PG_TABLE_KEY = 'form_poll_votes'

type PostgresSqlModule = { sql: typeof import('@payloadcms/db-postgres')['sql'] }

/**
 * Loads the optional Postgres peer without a literal specifier: bundlers (Turbopack, webpack,
 * Vite) resolve literal dynamic imports at build time, which fails a Mongo host's build even
 * though this branch is unreachable there. The function-built specifier is opaque to their
 * analyzers, the ignore comments cover bundlers that would still warn, and the type-only
 * reference above erases at compile time, so the package is touched only when the Postgres
 * branch actually runs.
 */
const importPostgresSql = (): Promise<PostgresSqlModule> => {
	const specifier = ['@payloadcms', 'db-postgres'].join('/')
	return import(
		/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ specifier
	) as Promise<PostgresSqlModule>
}

// payload.db raw-access shapes are intentionally loose; these narrow casts reach the
// Mongoose driver collection / Drizzle instance for atomic upserts (no public typed API).
type MongoDb = {
	name: 'mongoose'
	collections: Record<
		string,
		{ collection: { updateOne: (f: object, u: object, o: object) => Promise<unknown> } }
	>
	sessions?: Record<number | string, unknown>
}
type PgInsert = {
	insert: (t: unknown) => {
		values: (v: unknown) => { onConflictDoUpdate: (c: unknown) => Promise<unknown> }
	}
}
type PgDb = {
	name: 'postgres'
	drizzle: PgInsert
	sessions?: Record<number | string, { db: PgInsert }>
	tables: Record<string, Record<string, unknown>>
	tableNameMap: Map<string, string>
}

/**
 * Atomically bumps one (form, field, value) tally by `by` in a single upsert-increment
 * statement (Mongo `$inc` + upsert, Postgres `INSERT ... ON CONFLICT DO UPDATE`); the unique
 * compound index makes concurrent bumps for the same key safe without read-modify-write races.
 * The shard column is internal: transactional Mongo bumps pick a random shard in
 * [0, VOTE_SHARDS) so concurrent transactions rarely write the same document (see VOTE_SHARDS);
 * Postgres and non-transactional Mongo always bump shard 0. Readers sum across shards.
 *
 * When `transactionID` names an open Payload transaction, the write joins it: a bump failure
 * thrown from the submission hook rolls back the submission create (no undercount), and an
 * aborted create rolls back the joined bump (no overcount). Residual risk on transactional
 * Mongo: two concurrent bumps that land on the same shard still abort one transaction
 * (WriteConflict, labelled TransientTransactionError); the losing submission rolls back whole,
 * so counts stay consistent and the client can safely resubmit. Without a transaction (e.g.
 * Mongo with transactions disabled) the write lands on the root handle immediately; a later
 * recount from stored submissions is the healer for any drift that window allows.
 */
// biome-ignore lint/complexity/useMaxParams: write primitive signature (payload, key, by, transactionID)
export async function bumpPollVote(
	payload: Payload,
	key: { form: string; field: string; value: string },
	by: number,
	transactionID?: number | string
): Promise<void> {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[POLL_VOTES_SLUG]
		if (!model) throw new Error(`form-builder: mongoose collection "${POLL_VOTES_SLUG}" not found`)
		const session = transactionID !== undefined ? db.sessions?.[transactionID] : undefined
		const shard = session ? Math.floor(Math.random() * VOTE_SHARDS) : 0
		const shardedKey = { ...key, shard }
		const update = { $inc: { count: by }, $setOnInsert: shardedKey }
		const options = session ? { upsert: true, session } : { upsert: true }
		try {
			await model.collection.updateOne(shardedKey, update, options)
		} catch (error) {
			// Concurrent first inserts for a new key can race the upsert into E11000; outside a
			// transaction the row now exists, so one retry takes the $inc branch. Inside a
			// transaction the error propagates and Payload's rollback/retry semantics apply.
			const duplicate = (error as { code?: unknown } | null)?.code === 11000
			if (session || !duplicate) throw error
			await model.collection.updateOne(shardedKey, update, options)
		}
		return
	}
	const { sql } = await importPostgresSql()
	const db = payload.db as unknown as PgDb
	const tableName = db.tableNameMap.get(PG_TABLE_KEY)
	if (!tableName) throw new Error(`form-builder: drizzle table "${PG_TABLE_KEY}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`form-builder: drizzle table object for "${tableName}" not found`)
	const txn = transactionID !== undefined ? db.sessions?.[transactionID]?.db : undefined
	await (txn ?? db.drizzle)
		.insert(table)
		.values({ ...key, shard: 0, count: by })
		.onConflictDoUpdate({
			target: [table.form, table.field, table.value, table.shard],
			set: { count: sql`${table.count} + ${by}` },
		})
}
