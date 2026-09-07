import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Adds the goal-counter and scroll-depth growth of the native engine: four numeric columns
 * on the rollups collection (`required` with `defaultValue: 0`, so existing rows need the
 * zero written rather than left null), the optional goal columns on the events collection,
 * and the new `goal` member of the events `type` enum on Postgres. Mongo only needs the
 * rollup backfill: absent event fields are simply absent there. Every statement is
 * idempotent, so a push-mode dev schema that already picked the columns up is unaffected.
 * Index DDL is left to Payload's own schema push, as in the query-contract migration.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as {
			collections: Record<
				string,
				{ collection: { updateMany: (filter: object, update: object) => Promise<unknown> } }
			>
		}
		await db.collections['analytics-rollups']?.collection.updateMany(
			{ conversions: { $exists: false } },
			{ $set: { conversions: 0, revenue: 0, scrollDepthSum: 0, scrollSamples: 0 } }
		)
		return
	}
	const db = payload.db as unknown as { drizzle: { execute: (query: string) => Promise<unknown> } }
	for (const column of ['conversions', 'revenue', 'scroll_depth_sum', 'scroll_samples']) {
		await db.drizzle.execute(
			`ALTER TABLE analytics_rollups ADD COLUMN IF NOT EXISTS ${column} numeric NOT NULL DEFAULT 0`
		)
	}
	await db.drizzle.execute(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS value numeric`)
	await db.drizzle.execute(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS currency varchar`)
	await db.drizzle.execute(
		`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS scroll_depth numeric`
	)
	await db.drizzle.execute(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS goals jsonb`)
	// The events `type` select is backed by an enum, so accepting `goal` events is DDL.
	await db.drizzle.execute(`ALTER TYPE enum_analytics_events_type ADD VALUE IF NOT EXISTS 'goal'`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {}
