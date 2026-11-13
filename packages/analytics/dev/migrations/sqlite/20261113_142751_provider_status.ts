import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.run(sql`CREATE TABLE \`analytics_provider_status\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`last_success_at\` text,
  	\`last_error_at\` text,
  	\`error_kind\` text,
  	\`error_detail\` text,
  	\`paused_until\` text
  );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.run(sql`DROP TABLE \`analytics_provider_status\`;`)
}
