import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.run(sql`ALTER TABLE \`analytics_providers\` ADD \`is_default\` integer DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.run(sql`ALTER TABLE \`analytics_providers\` DROP COLUMN \`is_default\`;`)
}
