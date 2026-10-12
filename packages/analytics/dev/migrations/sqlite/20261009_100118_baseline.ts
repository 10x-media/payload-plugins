import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
	await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
	await db.run(
		sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`
	)
	await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
	await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
	await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
	await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
	await db.run(sql`CREATE TABLE \`pages_blocks_cta\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`heading\` text,
  	\`label\` text DEFAULT 'Book a demo' NOT NULL,
  	\`goal\` text NOT NULL,
  	\`block_name\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`pages_blocks_cta_order_idx\` ON \`pages_blocks_cta\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`pages_blocks_cta_parent_id_idx\` ON \`pages_blocks_cta\` (\`_parent_id\`);`
	)
	await db.run(sql`CREATE INDEX \`pages_blocks_cta_path_idx\` ON \`pages_blocks_cta\` (\`_path\`);`)
	await db.run(sql`CREATE TABLE \`pages\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text,
  	\`slug\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(sql`CREATE INDEX \`pages_updated_at_idx\` ON \`pages\` (\`updated_at\`);`)
	await db.run(sql`CREATE INDEX \`pages_created_at_idx\` ON \`pages\` (\`created_at\`);`)
	await db.run(sql`CREATE TABLE \`analytics_providers\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`provider\` text DEFAULT 'native' NOT NULL,
  	\`enabled\` integer DEFAULT true,
  	\`scope\` text,
  	\`plausible_site_id\` text,
  	\`plausible_api_key\` text,
  	\`plausible_apikey_hint\` text,
  	\`plausible_domain\` text,
  	\`plausible_script_id\` text,
  	\`plausible_revenue_currency\` text,
  	\`plausible_host\` text,
  	\`umami_website_id\` text,
  	\`umami_api_key\` text,
  	\`umami_apikey_hint\` text,
  	\`umami_token\` text,
  	\`umami_token_hint\` text,
  	\`umami_host\` text,
  	\`ga4_property_id\` text,
  	\`ga4_project_id\` text,
  	\`ga4_client_email\` text,
  	\`ga4_measurement_id\` text,
  	\`ga4_currency\` text,
  	\`ga4_private_key\` text,
  	\`posthog_project_id\` text,
  	\`posthog_api_key\` text,
  	\`posthog_apikey_hint\` text,
  	\`posthog_project_token\` text,
  	\`posthog_region\` text,
  	\`posthog_scope_property\` text,
  	\`posthog_host\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_scope_idx\` ON \`analytics_providers\` (\`scope\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_updated_at_idx\` ON \`analytics_providers\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_created_at_idx\` ON \`analytics_providers\` (\`created_at\`);`
	)
	await db.run(sql`CREATE TABLE \`analytics_goals\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`slug\` text NOT NULL,
  	\`enabled\` integer DEFAULT true,
  	\`browser\` integer DEFAULT true,
  	\`match_kind\` text DEFAULT 'goal' NOT NULL,
  	\`match_name\` text,
  	\`match_pattern\` text,
  	\`value_fixed\` numeric,
  	\`value_prop\` text,
  	\`currency\` text,
  	\`scope\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(sql`CREATE INDEX \`analytics_goals_scope_idx\` ON \`analytics_goals\` (\`scope\`);`)
	await db.run(
		sql`CREATE INDEX \`analytics_goals_updated_at_idx\` ON \`analytics_goals\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_goals_created_at_idx\` ON \`analytics_goals\` (\`created_at\`);`
	)
	await db.run(sql`CREATE UNIQUE INDEX \`slug_idx\` ON \`analytics_goals\` (\`slug\`);`)
	await db.run(sql`CREATE TABLE \`analytics_hits\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`scope\` text DEFAULT '' NOT NULL,
  	\`ts\` text NOT NULL,
  	\`last_at\` text,
  	\`type\` text NOT NULL,
  	\`hostname\` text NOT NULL,
  	\`path\` text NOT NULL,
  	\`v\` text NOT NULL,
  	\`landing\` integer DEFAULT false NOT NULL,
  	\`server\` integer DEFAULT false NOT NULL,
  	\`name\` text,
  	\`ref\` text,
  	\`source\` text,
  	\`channel\` text,
  	\`click_id\` text,
  	\`utm_source\` text,
  	\`utm_medium\` text,
  	\`utm_campaign\` text,
  	\`utm_content\` text,
  	\`utm_term\` text,
  	\`channel_version\` numeric,
  	\`country\` text,
  	\`region\` text,
  	\`city\` text,
  	\`language\` text,
  	\`device\` text,
  	\`browser\` text,
  	\`os\` text,
  	\`duration_ms\` numeric,
  	\`scroll_depth\` numeric,
  	\`value\` numeric,
  	\`original_value\` numeric,
  	\`conversions\` numeric,
  	\`revenue\` numeric,
  	\`currency\` text,
  	\`original_currency\` text,
  	\`item\` text,
  	\`props\` text,
  	\`goals\` text,
  	\`impressions\` text
  );
  `)
	await db.run(sql`CREATE INDEX \`scope_ts_idx\` ON \`analytics_hits\` (\`scope\`,\`ts\`);`)
	await db.run(sql`CREATE TABLE \`analytics_aggregates\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`scope\` text DEFAULT '' NOT NULL,
  	\`day\` numeric NOT NULL,
  	\`hostname\` text DEFAULT '' NOT NULL,
  	\`dim\` text DEFAULT '' NOT NULL,
  	\`value\` text DEFAULT '' NOT NULL,
  	\`dim2\` text DEFAULT '' NOT NULL,
  	\`value2\` text DEFAULT '' NOT NULL,
  	\`gen\` text NOT NULL,
  	\`pageviews\` numeric,
  	\`events\` numeric,
  	\`visitors\` numeric,
  	\`sessions\` numeric,
  	\`entries\` numeric,
  	\`bounces\` numeric,
  	\`session_ms\` numeric,
  	\`duration_ms\` numeric,
  	\`scroll_sum\` numeric,
  	\`scroll_samples\` numeric,
  	\`conversions\` numeric,
  	\`revenue\` numeric,
  	\`impressions\` numeric,
  	\`interactions\` numeric
  );
  `)
	await db.run(
		sql`CREATE INDEX \`scope_dim_dim2_day_idx\` ON \`analytics_aggregates\` (\`scope\`,\`dim\`,\`dim2\`,\`day\`);`
	)
	await db.run(
		sql`CREATE INDEX \`scope_dim_value_day_idx\` ON \`analytics_aggregates\` (\`scope\`,\`dim\`,\`value\`,\`day\`);`
	)
	await db.run(sql`CREATE TABLE \`analytics_state\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`kind\` text NOT NULL,
  	\`scope\` text DEFAULT '' NOT NULL,
  	\`day\` numeric,
  	\`tz\` text,
  	\`status\` text,
  	\`version\` numeric,
  	\`gen\` text,
  	\`hits\` numeric,
  	\`lease_owner\` text,
  	\`lease_until\` text,
  	\`final_after\` text,
  	\`aggregated_at\` text,
  	\`value\` text,
  	\`expires_at\` text
  );
  `)
	await db.run(
		sql`CREATE INDEX \`kind_status_day_idx\` ON \`analytics_state\` (\`kind\`,\`status\`,\`day\`);`
	)
	await db.run(
		sql`CREATE INDEX \`kind_scope_day_idx\` ON \`analytics_state\` (\`kind\`,\`scope\`,\`day\`);`
	)
	await db.run(sql`CREATE TABLE \`analytics_daily\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`source\` text NOT NULL,
  	\`date\` text NOT NULL,
  	\`scope\` text DEFAULT '' NOT NULL,
  	\`pageviews\` numeric,
  	\`visitors\` numeric,
  	\`sessions\` numeric,
  	\`avg_duration\` numeric,
  	\`visit_duration\` numeric,
  	\`bounce_rate\` numeric,
  	\`events\` numeric,
  	\`synced_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`analytics_daily_source_idx\` ON \`analytics_daily\` (\`source\`);`
	)
	await db.run(sql`CREATE INDEX \`analytics_daily_date_idx\` ON \`analytics_daily\` (\`date\`);`)
	await db.run(sql`CREATE INDEX \`analytics_daily_scope_idx\` ON \`analytics_daily\` (\`scope\`);`)
	await db.run(
		sql`CREATE INDEX \`analytics_daily_updated_at_idx\` ON \`analytics_daily\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_daily_created_at_idx\` ON \`analytics_daily\` (\`created_at\`);`
	)
	await db.run(
		sql`CREATE UNIQUE INDEX \`source_date_scope_idx\` ON \`analytics_daily\` (\`source\`,\`date\`,\`scope\`);`
	)
	await db.run(sql`CREATE TABLE \`analytics_cache\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`value\` text NOT NULL,
  	\`owner\` text,
  	\`fetched_at\` text NOT NULL,
  	\`expires_at\` text NOT NULL,
  	\`stale_until\` text NOT NULL,
  	\`read_at\` text,
  	\`recipe\` text
  );
  `)
	await db.run(
		sql`CREATE UNIQUE INDEX \`analytics_cache_key_idx\` ON \`analytics_cache\` (\`key\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_cache_stale_until_idx\` ON \`analytics_cache\` (\`stale_until\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_cache_read_at_idx\` ON \`analytics_cache\` (\`read_at\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
	await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
	await db.run(sql`CREATE TABLE \`payload_jobs_log\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`executed_at\` text NOT NULL,
  	\`completed_at\` text NOT NULL,
  	\`task_slug\` text NOT NULL,
  	\`task_i_d\` text NOT NULL,
  	\`input\` text,
  	\`output\` text,
  	\`state\` text NOT NULL,
  	\`error\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`payload_jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_log_order_idx\` ON \`payload_jobs_log\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_log_parent_id_idx\` ON \`payload_jobs_log\` (\`_parent_id\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_jobs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`input\` text,
  	\`completed_at\` text,
  	\`total_tried\` numeric DEFAULT 0,
  	\`has_error\` integer DEFAULT false,
  	\`error\` text,
  	\`task_slug\` text,
  	\`queue\` text DEFAULT 'default',
  	\`wait_until\` text,
  	\`processing\` integer DEFAULT false,
  	\`meta\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_completed_at_idx\` ON \`payload_jobs\` (\`completed_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_total_tried_idx\` ON \`payload_jobs\` (\`total_tried\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_has_error_idx\` ON \`payload_jobs\` (\`has_error\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_task_slug_idx\` ON \`payload_jobs\` (\`task_slug\`);`
	)
	await db.run(sql`CREATE INDEX \`payload_jobs_queue_idx\` ON \`payload_jobs\` (\`queue\`);`)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_wait_until_idx\` ON \`payload_jobs\` (\`wait_until\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_processing_idx\` ON \`payload_jobs\` (\`processing\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_updated_at_idx\` ON \`payload_jobs\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_created_at_idx\` ON \`payload_jobs\` (\`created_at\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`pages_id\` integer,
  	\`analytics_providers_id\` integer,
  	\`analytics_goals_id\` integer,
  	\`analytics_daily_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pages_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`analytics_providers_id\`) REFERENCES \`analytics_providers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`analytics_goals_id\`) REFERENCES \`analytics_goals\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`analytics_daily_id\`) REFERENCES \`analytics_daily\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_analytics_providers_id_idx\` ON \`payload_locked_documents_rels\` (\`analytics_providers_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_analytics_goals_id_idx\` ON \`payload_locked_documents_rels\` (\`analytics_goals_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_locked_documents_rels_analytics_daily_id_idx\` ON \`payload_locked_documents_rels\` (\`analytics_daily_id\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_jobs_stats\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`stats\` text,
  	\`updated_at\` text,
  	\`created_at\` text
  );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
	await db.run(sql`DROP TABLE \`users_sessions\`;`)
	await db.run(sql`DROP TABLE \`users\`;`)
	await db.run(sql`DROP TABLE \`pages_blocks_cta\`;`)
	await db.run(sql`DROP TABLE \`pages\`;`)
	await db.run(sql`DROP TABLE \`analytics_providers\`;`)
	await db.run(sql`DROP TABLE \`analytics_goals\`;`)
	await db.run(sql`DROP TABLE \`analytics_hits\`;`)
	await db.run(sql`DROP TABLE \`analytics_aggregates\`;`)
	await db.run(sql`DROP TABLE \`analytics_state\`;`)
	await db.run(sql`DROP TABLE \`analytics_daily\`;`)
	await db.run(sql`DROP TABLE \`analytics_cache\`;`)
	await db.run(sql`DROP TABLE \`payload_kv\`;`)
	await db.run(sql`DROP TABLE \`payload_jobs_log\`;`)
	await db.run(sql`DROP TABLE \`payload_jobs\`;`)
	await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
	await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
	await db.run(sql`DROP TABLE \`payload_preferences\`;`)
	await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
	await db.run(sql`DROP TABLE \`payload_migrations\`;`)
	await db.run(sql`DROP TABLE \`payload_jobs_stats\`;`)
}
