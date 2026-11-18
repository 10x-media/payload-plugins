import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.execute(sql`
  ALTER TABLE "impersonation_sessions" ADD COLUMN "impersonator_strategy" varchar;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.execute(sql`
  ALTER TABLE "impersonation_sessions" DROP COLUMN "impersonator_strategy";
  `)
}
