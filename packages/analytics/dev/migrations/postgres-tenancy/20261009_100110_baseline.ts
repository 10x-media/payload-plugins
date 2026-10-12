import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.execute(sql`
   CREATE TYPE "public"."enum_analytics_providers_provider" AS ENUM('native', 'plausible', 'umami', 'ga4', 'posthog');
  CREATE TYPE "public"."enum_analytics_providers_posthog_region" AS ENUM('us', 'eu');
  CREATE TYPE "public"."enum_analytics_goals_match_kind" AS ENUM('goal', 'event', 'path');
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'analytics-maintain', 'analytics-warm', 'analytics-sync');
  CREATE TYPE "public"."enum_payload_jobs_log_state" AS ENUM('failed', 'succeeded');
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'analytics-maintain', 'analytics-warm', 'analytics-sync');
  CREATE TABLE "users_tenants" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tenant_id" integer NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "pages_blocks_cta" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"label" varchar DEFAULT 'Book a demo' NOT NULL,
  	"goal" varchar NOT NULL,
  	"block_name" varchar
  );
  
  CREATE TABLE "pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tenants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"timezone" varchar DEFAULT 'America/New_York',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "offers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "analytics_providers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"name" varchar NOT NULL,
  	"provider" "enum_analytics_providers_provider" DEFAULT 'native' NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"plausible_site_id" varchar,
  	"plausible_api_key" varchar,
  	"plausible_apikey_hint" varchar,
  	"plausible_domain" varchar,
  	"plausible_script_id" varchar,
  	"plausible_revenue_currency" varchar,
  	"plausible_host" varchar,
  	"umami_website_id" varchar,
  	"umami_api_key" varchar,
  	"umami_apikey_hint" varchar,
  	"umami_token" varchar,
  	"umami_token_hint" varchar,
  	"umami_host" varchar,
  	"ga4_property_id" varchar,
  	"ga4_project_id" varchar,
  	"ga4_client_email" varchar,
  	"ga4_measurement_id" varchar,
  	"ga4_currency" varchar,
  	"ga4_private_key" varchar,
  	"posthog_project_id" varchar,
  	"posthog_api_key" varchar,
  	"posthog_apikey_hint" varchar,
  	"posthog_project_token" varchar,
  	"posthog_region" "enum_analytics_providers_posthog_region",
  	"posthog_scope_property" varchar,
  	"posthog_host" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "analytics_goals" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"browser" boolean DEFAULT true,
  	"match_kind" "enum_analytics_goals_match_kind" DEFAULT 'goal' NOT NULL,
  	"match_name" varchar,
  	"match_pattern" varchar,
  	"value_fixed" numeric,
  	"value_prop" varchar,
  	"currency" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "analytics_hits" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"scope" varchar DEFAULT '' NOT NULL,
  	"ts" timestamp(3) with time zone NOT NULL,
  	"last_at" timestamp(3) with time zone,
  	"type" varchar NOT NULL,
  	"hostname" varchar NOT NULL,
  	"path" varchar NOT NULL,
  	"v" varchar NOT NULL,
  	"landing" boolean DEFAULT false NOT NULL,
  	"server" boolean DEFAULT false NOT NULL,
  	"name" varchar,
  	"ref" varchar,
  	"source" varchar,
  	"channel" varchar,
  	"click_id" varchar,
  	"utm_source" varchar,
  	"utm_medium" varchar,
  	"utm_campaign" varchar,
  	"utm_content" varchar,
  	"utm_term" varchar,
  	"channel_version" numeric,
  	"country" varchar,
  	"region" varchar,
  	"city" varchar,
  	"language" varchar,
  	"device" varchar,
  	"browser" varchar,
  	"os" varchar,
  	"duration_ms" numeric,
  	"scroll_depth" numeric,
  	"value" numeric,
  	"original_value" numeric,
  	"conversions" numeric,
  	"revenue" numeric,
  	"currency" varchar,
  	"original_currency" varchar,
  	"item" varchar,
  	"props" jsonb,
  	"goals" jsonb,
  	"impressions" jsonb
  );
  
  CREATE TABLE "analytics_aggregates" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"scope" varchar DEFAULT '' NOT NULL,
  	"day" numeric NOT NULL,
  	"hostname" varchar DEFAULT '' NOT NULL,
  	"dim" varchar DEFAULT '' NOT NULL,
  	"value" varchar DEFAULT '' NOT NULL,
  	"dim2" varchar DEFAULT '' NOT NULL,
  	"value2" varchar DEFAULT '' NOT NULL,
  	"gen" varchar NOT NULL,
  	"pageviews" numeric,
  	"events" numeric,
  	"visitors" numeric,
  	"sessions" numeric,
  	"entries" numeric,
  	"bounces" numeric,
  	"session_ms" numeric,
  	"duration_ms" numeric,
  	"scroll_sum" numeric,
  	"scroll_samples" numeric,
  	"conversions" numeric,
  	"revenue" numeric,
  	"impressions" numeric,
  	"interactions" numeric
  );
  
  CREATE TABLE "analytics_state" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"kind" varchar NOT NULL,
  	"scope" varchar DEFAULT '' NOT NULL,
  	"day" numeric,
  	"tz" varchar,
  	"status" varchar,
  	"version" numeric,
  	"gen" varchar,
  	"hits" numeric,
  	"lease_owner" varchar,
  	"lease_until" timestamp(3) with time zone,
  	"final_after" timestamp(3) with time zone,
  	"aggregated_at" timestamp(3) with time zone,
  	"value" jsonb,
  	"expires_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "analytics_daily" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source" varchar NOT NULL,
  	"date" timestamp(3) with time zone NOT NULL,
  	"scope" varchar DEFAULT '' NOT NULL,
  	"pageviews" numeric,
  	"visitors" numeric,
  	"sessions" numeric,
  	"avg_duration" numeric,
  	"visit_duration" numeric,
  	"bounce_rate" numeric,
  	"events" numeric,
  	"synced_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "analytics_cache" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"value" jsonb NOT NULL,
  	"owner" varchar,
  	"fetched_at" timestamp(3) with time zone NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"stale_until" timestamp(3) with time zone NOT NULL,
  	"read_at" timestamp(3) with time zone,
  	"recipe" jsonb
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_jobs_log" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"executed_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone NOT NULL,
  	"task_slug" "enum_payload_jobs_log_task_slug" NOT NULL,
  	"task_i_d" varchar NOT NULL,
  	"input" jsonb,
  	"output" jsonb,
  	"state" "enum_payload_jobs_log_state" NOT NULL,
  	"error" jsonb
  );
  
  CREATE TABLE "payload_jobs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"input" jsonb,
  	"completed_at" timestamp(3) with time zone,
  	"total_tried" numeric DEFAULT 0,
  	"has_error" boolean DEFAULT false,
  	"error" jsonb,
  	"task_slug" "enum_payload_jobs_task_slug",
  	"queue" varchar DEFAULT 'default',
  	"wait_until" timestamp(3) with time zone,
  	"processing" boolean DEFAULT false,
  	"meta" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"pages_id" integer,
  	"tenants_id" integer,
  	"offers_id" integer,
  	"analytics_providers_id" integer,
  	"analytics_goals_id" integer,
  	"analytics_daily_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_jobs_stats" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stats" jsonb,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "users_tenants" ADD CONSTRAINT "users_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_tenants" ADD CONSTRAINT "users_tenants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_cta" ADD CONSTRAINT "pages_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "offers" ADD CONSTRAINT "offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "analytics_providers" ADD CONSTRAINT "analytics_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "analytics_goals" ADD CONSTRAINT "analytics_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_jobs_log" ADD CONSTRAINT "payload_jobs_log_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."payload_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tenants_fk" FOREIGN KEY ("tenants_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_offers_fk" FOREIGN KEY ("offers_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_analytics_providers_fk" FOREIGN KEY ("analytics_providers_id") REFERENCES "public"."analytics_providers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_analytics_goals_fk" FOREIGN KEY ("analytics_goals_id") REFERENCES "public"."analytics_goals"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_analytics_daily_fk" FOREIGN KEY ("analytics_daily_id") REFERENCES "public"."analytics_daily"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_tenants_order_idx" ON "users_tenants" USING btree ("_order");
  CREATE INDEX "users_tenants_parent_id_idx" ON "users_tenants" USING btree ("_parent_id");
  CREATE INDEX "users_tenants_tenant_idx" ON "users_tenants" USING btree ("tenant_id");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "pages_blocks_cta_order_idx" ON "pages_blocks_cta" USING btree ("_order");
  CREATE INDEX "pages_blocks_cta_parent_id_idx" ON "pages_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_cta_path_idx" ON "pages_blocks_cta" USING btree ("_path");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");
  CREATE INDEX "tenants_updated_at_idx" ON "tenants" USING btree ("updated_at");
  CREATE INDEX "tenants_created_at_idx" ON "tenants" USING btree ("created_at");
  CREATE INDEX "offers_tenant_idx" ON "offers" USING btree ("tenant_id");
  CREATE INDEX "offers_updated_at_idx" ON "offers" USING btree ("updated_at");
  CREATE INDEX "offers_created_at_idx" ON "offers" USING btree ("created_at");
  CREATE INDEX "analytics_providers_tenant_idx" ON "analytics_providers" USING btree ("tenant_id");
  CREATE INDEX "analytics_providers_updated_at_idx" ON "analytics_providers" USING btree ("updated_at");
  CREATE INDEX "analytics_providers_created_at_idx" ON "analytics_providers" USING btree ("created_at");
  CREATE INDEX "analytics_goals_tenant_idx" ON "analytics_goals" USING btree ("tenant_id");
  CREATE INDEX "analytics_goals_slug_idx" ON "analytics_goals" USING btree ("slug");
  CREATE INDEX "analytics_goals_updated_at_idx" ON "analytics_goals" USING btree ("updated_at");
  CREATE INDEX "analytics_goals_created_at_idx" ON "analytics_goals" USING btree ("created_at");
  CREATE INDEX "scope_ts_idx" ON "analytics_hits" USING btree ("scope","ts");
  CREATE INDEX "scope_dim_dim2_day_idx" ON "analytics_aggregates" USING btree ("scope","dim","dim2","day");
  CREATE INDEX "scope_dim_value_day_idx" ON "analytics_aggregates" USING btree ("scope","dim","value","day");
  CREATE INDEX "kind_status_day_idx" ON "analytics_state" USING btree ("kind","status","day");
  CREATE INDEX "kind_scope_day_idx" ON "analytics_state" USING btree ("kind","scope","day");
  CREATE INDEX "analytics_daily_source_idx" ON "analytics_daily" USING btree ("source");
  CREATE INDEX "analytics_daily_date_idx" ON "analytics_daily" USING btree ("date");
  CREATE INDEX "analytics_daily_scope_idx" ON "analytics_daily" USING btree ("scope");
  CREATE INDEX "analytics_daily_updated_at_idx" ON "analytics_daily" USING btree ("updated_at");
  CREATE INDEX "analytics_daily_created_at_idx" ON "analytics_daily" USING btree ("created_at");
  CREATE UNIQUE INDEX "source_date_scope_idx" ON "analytics_daily" USING btree ("source","date","scope");
  CREATE UNIQUE INDEX "analytics_cache_key_idx" ON "analytics_cache" USING btree ("key");
  CREATE INDEX "analytics_cache_stale_until_idx" ON "analytics_cache" USING btree ("stale_until");
  CREATE INDEX "analytics_cache_read_at_idx" ON "analytics_cache" USING btree ("read_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_jobs_log_order_idx" ON "payload_jobs_log" USING btree ("_order");
  CREATE INDEX "payload_jobs_log_parent_id_idx" ON "payload_jobs_log" USING btree ("_parent_id");
  CREATE INDEX "payload_jobs_completed_at_idx" ON "payload_jobs" USING btree ("completed_at");
  CREATE INDEX "payload_jobs_total_tried_idx" ON "payload_jobs" USING btree ("total_tried");
  CREATE INDEX "payload_jobs_has_error_idx" ON "payload_jobs" USING btree ("has_error");
  CREATE INDEX "payload_jobs_task_slug_idx" ON "payload_jobs" USING btree ("task_slug");
  CREATE INDEX "payload_jobs_queue_idx" ON "payload_jobs" USING btree ("queue");
  CREATE INDEX "payload_jobs_wait_until_idx" ON "payload_jobs" USING btree ("wait_until");
  CREATE INDEX "payload_jobs_processing_idx" ON "payload_jobs" USING btree ("processing");
  CREATE INDEX "payload_jobs_updated_at_idx" ON "payload_jobs" USING btree ("updated_at");
  CREATE INDEX "payload_jobs_created_at_idx" ON "payload_jobs" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");
  CREATE INDEX "payload_locked_documents_rels_tenants_id_idx" ON "payload_locked_documents_rels" USING btree ("tenants_id");
  CREATE INDEX "payload_locked_documents_rels_offers_id_idx" ON "payload_locked_documents_rels" USING btree ("offers_id");
  CREATE INDEX "payload_locked_documents_rels_analytics_providers_id_idx" ON "payload_locked_documents_rels" USING btree ("analytics_providers_id");
  CREATE INDEX "payload_locked_documents_rels_analytics_goals_id_idx" ON "payload_locked_documents_rels" USING btree ("analytics_goals_id");
  CREATE INDEX "payload_locked_documents_rels_analytics_daily_id_idx" ON "payload_locked_documents_rels" USING btree ("analytics_daily_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.execute(sql`
   DROP TABLE "users_tenants" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "pages_blocks_cta" CASCADE;
  DROP TABLE "pages" CASCADE;
  DROP TABLE "tenants" CASCADE;
  DROP TABLE "offers" CASCADE;
  DROP TABLE "analytics_providers" CASCADE;
  DROP TABLE "analytics_goals" CASCADE;
  DROP TABLE "analytics_hits" CASCADE;
  DROP TABLE "analytics_aggregates" CASCADE;
  DROP TABLE "analytics_state" CASCADE;
  DROP TABLE "analytics_daily" CASCADE;
  DROP TABLE "analytics_cache" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_jobs_log" CASCADE;
  DROP TABLE "payload_jobs" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "payload_jobs_stats" CASCADE;
  DROP TYPE "public"."enum_analytics_providers_provider";
  DROP TYPE "public"."enum_analytics_providers_posthog_region";
  DROP TYPE "public"."enum_analytics_goals_match_kind";
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  DROP TYPE "public"."enum_payload_jobs_log_state";
  DROP TYPE "public"."enum_payload_jobs_task_slug";`)
}
