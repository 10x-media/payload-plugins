import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.execute(sql`
   CREATE TABLE "analytics_provider_status" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"last_success_at" timestamp(3) with time zone,
  	"last_error_at" timestamp(3) with time zone,
  	"error_kind" varchar,
  	"error_detail" varchar,
  	"paused_until" timestamp(3) with time zone
  );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.execute(sql`
   DROP TABLE "analytics_provider_status" CASCADE;`)
}
