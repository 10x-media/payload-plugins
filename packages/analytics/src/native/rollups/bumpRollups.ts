import type { Payload } from 'payload'
import { ROLLUPS_SLUG } from '../collections/rollups'
import { bucketKey } from './bucketKey'
import type { RollupKey, RollupMetric } from './deltas'

const PG_TABLE_KEY = 'analytics_rollups'

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
	collections: Record<string, { collection: { bulkWrite: (ops: object[], o: object) => unknown } }>
}
type PgDb = {
	name: 'postgres'
	drizzle: {
		insert: (t: unknown) => {
			values: (v: unknown[]) => { onConflictDoUpdate: (c: unknown) => Promise<unknown> }
		}
	}
	tables: Record<string, Record<string, unknown>>
	tableNameMap: Map<string, string>
}

export const ROLLUP_ZERO: Record<RollupMetric, number> = {
	pageviews: 0,
	events: 0,
	durationMs: 0,
	samples: 0,
	visitors: 0,
	sessions: 0,
	conversions: 0,
	revenue: 0,
	scrollDepthSum: 0,
	scrollSamples: 0,
}

export interface RollupBump {
	key: RollupKey
	inc: Partial<Record<RollupMetric, number>>
}

/**
 * Sums bumps that land on the same bucket. Required, not an optimization: Postgres rejects a
 * statement whose ON CONFLICT DO UPDATE would touch one row twice, and a flush routinely
 * bumps a bucket's visitors and sessions in the same call.
 */
const coalesce = (bumps: RollupBump[]): RollupBump[] => {
	const merged = new Map<string, RollupBump>()
	for (const bump of bumps) {
		const existing = merged.get(bucketKey(bump.key))
		if (!existing) {
			merged.set(bucketKey(bump.key), { key: bump.key, inc: { ...bump.inc } })
			continue
		}
		for (const [metric, amount] of Object.entries(bump.inc) as Array<[RollupMetric, number]>) {
			existing.inc[metric] = (existing.inc[metric] ?? 0) + amount
		}
	}
	return [...merged.values()]
}

/**
 * Upserts every bucket in one statement per database, incrementing where the row exists and
 * seeding the full metric baseline where it does not (Payload's defaultValue is applied
 * app-side, not as a SQL default, so a raw insert that omits a NOT NULL metric would fail on
 * Postgres). This is the write path a flush uses: one round trip instead of one per bucket,
 * which is the difference between a handful and a few hundred per ingested hit.
 */
export async function bumpRollups(payload: Payload, bumps: RollupBump[]): Promise<void> {
	const merged = coalesce(bumps)
	if (merged.length === 0) {
		return
	}
	// A batch belongs to one install shape: scope is part of the unique bucket where it is
	// present, and Postgres needs one conflict target for the whole statement. A mixed batch has
	// no single right answer, so it is a caller bug on both adapters rather than rows quietly
	// filed under the first bucket's shape.
	const scoped = merged[0]?.key.scope !== undefined
	if (merged.some(({ key }) => (key.scope !== undefined) !== scoped)) {
		throw new Error('analytics: rollup bumps mix scoped and unscoped buckets in one batch')
	}
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as MongoDb
		const model = db.collections[ROLLUPS_SLUG]
		if (!model) throw new Error(`analytics: mongoose collection "${ROLLUPS_SLUG}" not found`)
		const ops = merged.map(({ key, inc }) => {
			const setOnInsert: Record<string, unknown> = { ...key }
			for (const [metric, zero] of Object.entries(ROLLUP_ZERO)) {
				if (!(metric in inc)) setOnInsert[metric] = zero
			}
			// $inc rejects an empty operand, so a bump with no metrics only seeds the row.
			const update =
				Object.keys(inc).length > 0
					? { $inc: inc, $setOnInsert: setOnInsert }
					: { $setOnInsert: setOnInsert }
			return { updateOne: { filter: key, update, upsert: true } }
		})
		await model.collection.bulkWrite(ops, { ordered: false })
		return
	}
	const { sql } = await importPostgresSql()
	const db = payload.db as unknown as PgDb
	const tableName = db.tableNameMap.get(PG_TABLE_KEY)
	if (!tableName) throw new Error(`analytics: drizzle table "${PG_TABLE_KEY}" not found`)
	const table = db.tables[tableName]
	if (!table) throw new Error(`analytics: drizzle table object for "${tableName}" not found`)
	// Every metric is updated from `excluded`, the row this statement tried to insert, so one
	// statement can carry a different set of increments per bucket. The metrics a bump does
	// not name are zero in its row, and adding zero is the no-op it should be.
	const set: Record<string, unknown> = {}
	for (const metric of Object.keys(ROLLUP_ZERO)) {
		const column = table[metric] as { name?: string } | undefined
		if (!column?.name) throw new Error(`analytics: rollup column "${metric}" not found`)
		set[metric] = sql`${table[metric]} + excluded.${sql.identifier(column.name)}`
	}
	// The conflict target must match the unique index exactly, which carries the scope column
	// only in scoped installs.
	const target = [
		table.granularity,
		table.period,
		table.path,
		table.dimension,
		table.dimvalue,
		table.hostname,
	]
	if (scoped) {
		target.push(table.scope)
	}
	await db.drizzle
		.insert(table)
		.values(merged.map(({ key, inc }) => ({ ...key, ...ROLLUP_ZERO, ...inc })))
		.onConflictDoUpdate({ target, set })
}
