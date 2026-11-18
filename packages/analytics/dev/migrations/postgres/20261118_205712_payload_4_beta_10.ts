import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
	await db.execute(sql`
   ALTER TABLE "users_sessions" ADD COLUMN "label" varchar;
  ALTER TABLE "users_sessions" ADD COLUMN "type" varchar;
  ALTER TABLE "users_sessions" ADD COLUMN "metadata" jsonb;
  ALTER TABLE "_users_v_version_sessions" ADD COLUMN "label" varchar;
  ALTER TABLE "_users_v_version_sessions" ADD COLUMN "type" varchar;
  ALTER TABLE "_users_v_version_sessions" ADD COLUMN "metadata" jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
	await db.execute(sql`
   ALTER TABLE "users_sessions" DROP COLUMN "label";
  ALTER TABLE "users_sessions" DROP COLUMN "type";
  ALTER TABLE "users_sessions" DROP COLUMN "metadata";
  ALTER TABLE "_users_v_version_sessions" DROP COLUMN "label";
  ALTER TABLE "_users_v_version_sessions" DROP COLUMN "type";
  ALTER TABLE "_users_v_version_sessions" DROP COLUMN "metadata";`)
}
