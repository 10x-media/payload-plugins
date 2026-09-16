import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Adds the nine dimension columns the native engine now classifies at ingest: the browser,
 * OS and language families, the five campaign keys, and the referrer host the `referrer`
 * dimension groups and filters on. Rollup rows are keyed by dimension name, so the rollups
 * collection is unchanged, and Mongo needs nothing at all: the fields are optional, and an
 * event written before this release simply carries none of them, which is exactly what "no
 * bucket for that dimension" already means.
 *
 * Every statement is `ADD COLUMN IF NOT EXISTS`, so the whole migration is re-runnable and a
 * push-mode dev schema that already picked the columns up is left alone. It goes through
 * `payload.db.drizzle` for consistency with the migrations beside it; plain `ADD COLUMN`
 * needs nothing of the pool handle that `ALTER TYPE ... ADD VALUE` did.
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
