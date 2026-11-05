import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.execute(sql`
   CREATE TYPE "public"."enum_analytics_providers_without_consent" AS ENUM('cookieless', 'off');
  ALTER TABLE "analytics_providers" ADD COLUMN "without_consent" "enum_analytics_providers_without_consent";
  ALTER TABLE "analytics_hits" ADD COLUMN "mode" varchar;
  ALTER TABLE "analytics_aggregates" ADD COLUMN "pageviews_without_visitor" numeric;
  ALTER TABLE "analytics_aggregates" ADD COLUMN "pageviews_without_consent" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.execute(sql`
   ALTER TABLE "analytics_providers" DROP COLUMN "without_consent";
  ALTER TABLE "analytics_hits" DROP COLUMN "mode";
  ALTER TABLE "analytics_aggregates" DROP COLUMN "pageviews_without_visitor";
  ALTER TABLE "analytics_aggregates" DROP COLUMN "pageviews_without_consent";
  DROP TYPE "public"."enum_analytics_providers_without_consent";`)
}
