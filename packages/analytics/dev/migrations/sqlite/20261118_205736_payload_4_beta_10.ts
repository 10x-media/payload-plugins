import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
	await db.run(sql`ALTER TABLE \`users_sessions\` ADD \`label\` text;`)
	await db.run(sql`ALTER TABLE \`users_sessions\` ADD \`type\` text;`)
	await db.run(sql`ALTER TABLE \`users_sessions\` ADD \`metadata\` text;`)
	await db.run(sql`ALTER TABLE \`_users_v_version_sessions\` ADD \`label\` text;`)
	await db.run(sql`ALTER TABLE \`_users_v_version_sessions\` ADD \`type\` text;`)
	await db.run(sql`ALTER TABLE \`_users_v_version_sessions\` ADD \`metadata\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
	await db.run(sql`ALTER TABLE \`users_sessions\` DROP COLUMN \`label\`;`)
	await db.run(sql`ALTER TABLE \`users_sessions\` DROP COLUMN \`type\`;`)
	await db.run(sql`ALTER TABLE \`users_sessions\` DROP COLUMN \`metadata\`;`)
	await db.run(sql`ALTER TABLE \`_users_v_version_sessions\` DROP COLUMN \`label\`;`)
	await db.run(sql`ALTER TABLE \`_users_v_version_sessions\` DROP COLUMN \`type\`;`)
	await db.run(sql`ALTER TABLE \`_users_v_version_sessions\` DROP COLUMN \`metadata\`;`)
}
