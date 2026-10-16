import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.run(sql`ALTER TABLE \`analytics_providers\` ADD \`without_consent\` text;`)
	await db.run(sql`ALTER TABLE \`analytics_hits\` ADD \`mode\` text;`)
	await db.run(sql`ALTER TABLE \`analytics_aggregates\` ADD \`pageviews_without_visitor\` numeric;`)
	await db.run(sql`ALTER TABLE \`analytics_aggregates\` ADD \`pageviews_without_consent\` numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.run(sql`ALTER TABLE \`analytics_providers\` DROP COLUMN \`without_consent\`;`)
	await db.run(sql`ALTER TABLE \`analytics_hits\` DROP COLUMN \`mode\`;`)
	await db.run(sql`ALTER TABLE \`analytics_aggregates\` DROP COLUMN \`pageviews_without_visitor\`;`)
	await db.run(sql`ALTER TABLE \`analytics_aggregates\` DROP COLUMN \`pageviews_without_consent\`;`)
}
