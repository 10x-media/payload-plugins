import type { Payload } from 'payload'

// payload.db raw-access shapes are intentionally loose; these narrow casts reach the
// Mongoose driver collection / Drizzle instance directly (no public typed API).
type MongoDb = {
	name: 'mongoose'
	collections: Record<
		string,
		{ collection: { insertMany: (docs: object[], o: object) => Promise<unknown> } }
	>
}
type PgDb = {
	name: 'postgres'
	drizzle: {
		insert: (t: unknown) => {
			values: (v: unknown[]) => {
				onConflictDoNothing: () => { returning: () => Promise<Array<Record<string, unknown>>> }
			}
		}
	}
	tables: Record<string, Record<string, unknown>>
	tableNameMap: Map<string, string>
}

/** Mongo duplicate key. */
const MONGO_DUPLICATE = 11000

type WriteError = { index?: unknown; code?: unknown }

/**
 * Which rows of an unordered `insertMany` the index rejected, or undefined when the failure
 * was something else entirely (a dead connection, a validation error) and must be rethrown
 * rather than read as "already seen".
 */
const duplicateIndexes = (err: unknown): Set<number> | undefined => {
	if (typeof err !== 'object' || err === null) {
		return undefined
	}
	const raw = (err as { writeErrors?: unknown }).writeErrors
	const errors: WriteError[] = Array.isArray(raw) ? raw : raw ? [raw as WriteError] : []
	if (errors.length === 0) {
		// A single-document rejection can arrive as a plain duplicate-key error with no
		// writeErrors array at all.
		return (err as { code?: unknown }).code === MONGO_DUPLICATE ? new Set([0]) : undefined
	}
	const indexes = new Set<number>()
	for (const error of errors) {
		if (error.code !== MONGO_DUPLICATE || typeof error.index !== 'number') {
			return undefined
		}
		indexes.add(error.index)
	}
	return indexes
}

/**
 * Row identity for matching a returned row back to the row that asked for it. A date field is
 * normalized through Date because Postgres hands a timestamp back as its own text
 * (`2026-08-01 00:00:00+00`) rather than as the Date that was sent.
 */
const rowKey = (
	row: Record<string, unknown>,
	fields: string[],
	dateFields: ReadonlySet<string>
): string =>
	JSON.stringify(
		fields.map((field) => {
			const value = row[field]
			if (!dateFields.has(field)) {
				return String(value)
			}
			const time = new Date(value as string | Date).getTime()
			return Number.isNaN(time) ? String(value) : time
		})
	)

/**
 * `insertIfNew` for a whole batch: one statement, one answer per row in the order they were
 * given, true where that row was the one that created the ledger entry. The unique index is
 * still the entire correctness mechanism, so a row another writer inserted first comes back
 * false whether the driver reports it quietly or as a duplicate-key error.
 *
 * A row repeated inside one batch counts once, the first occurrence: Mongo would answer the
 * repeat with a duplicate-key error while Postgres skips it silently, so the batch is
 * de-duplicated here and both databases give the same answer.
 */
export async function insertManyIfNew(
	payload: Payload,
	slug: string,
	rows: Array<Record<string, unknown>>
): Promise<boolean[]> {
	if (rows.length === 0) {
		return []
	}
	const fields = Object.keys(rows[0] as Record<string, unknown>)
	const dateFields = new Set(fields.filter((f) => rows.some((row) => row[f] instanceof Date)))
	const seenInBatch = new Set<string>()
	const first: boolean[] = rows.map((row) => {
		const key = rowKey(row, fields, dateFields)
		if (seenInBatch.has(key)) {
			return false
		}
		seenInBatch.add(key)
		return true
	})
	const attempts = rows.filter((_, index) => first[index])

	const answer = (attempted: boolean[]): boolean[] => {
		let next = 0
		return first.map((isFirst) => (isFirst ? (attempted[next++] ?? false) : false))
	}

	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[slug]
		if (!model) throw new Error(`analytics: mongoose collection "${slug}" not found`)
		try {
			// Copies, because insertMany stamps an _id onto every document it is handed.
			await model.collection.insertMany(
				attempts.map((row) => ({ ...row })),
				{ ordered: false }
			)
			return answer(attempts.map(() => true))
		} catch (err) {
			const duplicates = duplicateIndexes(err)
			if (!duplicates) throw err
			return answer(attempts.map((_, index) => !duplicates.has(index)))
		}
	}
	const db = payload.db as unknown as PgDb
	const tableKey = slug.replace(/-/g, '_')
	const tableName = db.tableNameMap.get(tableKey)
	if (!tableName) throw new Error(`analytics: drizzle table "${tableKey}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`analytics: drizzle table object for "${tableName}" not found`)
	const inserted = await db.drizzle.insert(table).values(attempts).onConflictDoNothing().returning()
	// Returned rows say which inserts happened, not which row asked for them, so they are
	// matched back by value. A count rather than a flag, so identical rows stay one to one.
	const created = new Map<string, number>()
	for (const row of inserted) {
		const key = rowKey(row, fields, dateFields)
		created.set(key, (created.get(key) ?? 0) + 1)
	}
	return answer(
		attempts.map((row) => {
			const key = rowKey(row, fields, dateFields)
			const remaining = created.get(key) ?? 0
			if (remaining === 0) {
				return false
			}
			created.set(key, remaining - 1)
			return true
		})
	)
}
