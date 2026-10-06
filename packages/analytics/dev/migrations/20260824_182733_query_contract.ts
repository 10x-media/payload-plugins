import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

/**
 * Backfills the query-contract columns added in this release: `hostname` on the native
 * rollups collection and `scope` on the sync collection. Both are unique-index members
 * with `defaultValue: ''`, so existing rows need the empty string written explicitly
 * rather than left null. Postgres production installs also need the column added; push-mode
 * dev schemas already picked it up via schema push, so the ADD COLUMN is idempotent
 * (`IF NOT EXISTS`). Index DDL is left to Payload's own schema push rather than run here.
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
			{ hostname: { $exists: false } },
			{ $set: { hostname: '' } }
		)
		await db.collections['analytics-daily']?.collection.updateMany(
			{ scope: { $exists: false } },
			{ $set: { scope: '' } }
		)
		return
	}
	const db = payload.db as unknown as { drizzle: { execute: (query: string) => Promise<unknown> } }
	await db.drizzle.execute(
		`ALTER TABLE analytics_rollups ADD COLUMN IF NOT EXISTS hostname varchar NOT NULL DEFAULT ''`
	)
	await db.drizzle.execute(
		`ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS scope varchar NOT NULL DEFAULT ''`
	)
}

export async function down(_args: MigrateDownArgs): Promise<void> {}
