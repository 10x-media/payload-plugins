import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.execute(sql`
   ALTER TABLE "analytics_providers" ADD COLUMN "is_default" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.execute(sql`
   ALTER TABLE "analytics_providers" DROP COLUMN "is_default";`)
}
