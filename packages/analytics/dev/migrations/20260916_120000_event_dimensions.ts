import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Adds the nine dimension columns the native engine now classifies at ingest: the browser,
 * OS and language families, the five campaign keys, and the referrer host the `referrer`
 * dimension groups and filters on. Rollup rows are keyed by dimension name, so the rollups
 * collection is unchanged, and Mongo needs nothing at all: the fields are optional, and an
 * event written before this release simply carries none of them, which is exactly what "no
 * bucket for that dimension" already means. Every statement is idempotent, so a push-mode
 * dev schema that already picked the columns up is unaffected.
 *
 * The Postgres statements deliberately go through `payload.db.drizzle` (the pool handle)
 * rather than the transaction-bound argument, matching the goal-counters migration: each
 * autocommits instead of being pinned inside an open transaction.
 */
export async function up({ payload }: MigrateUpArgs): Promise<void> {
	if (payload.db.name === 'mongoose') {
		return
	}
	const db = payload.db as unknown as { drizzle: { execute: (query: string) => Promise<unknown> } }
	for (const column of [
		'browser',
		'os',
		'language',
		'utm_source',
		'utm_medium',
		'utm_campaign',
		'utm_content',
		'utm_term',
		'referrer_host',
	]) {
		await db.drizzle.execute(
			`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS ${column} varchar`
		)
	}
}

/** Deliberately irreversible: dropping the columns would discard already-attributed events. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
