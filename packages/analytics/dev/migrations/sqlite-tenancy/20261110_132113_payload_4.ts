import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
	await db.run(sql`CREATE TABLE \`users_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`users_rels_order_idx\` ON \`users_rels\` (\`order\`);`)
	await db.run(sql`CREATE INDEX \`users_rels_parent_idx\` ON \`users_rels\` (\`parent_id\`);`)
	await db.run(sql`CREATE INDEX \`users_rels_path_idx\` ON \`users_rels\` (\`path\`);`)
	await db.run(sql`CREATE INDEX \`users_rels_users_id_idx\` ON \`users_rels\` (\`users_id\`);`)
	await db.run(sql`CREATE TABLE \`_users_v_version_tenants\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`tenant_id\` integer NOT NULL,
  	\`_uuid\` text,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_users_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_tenants_order_idx\` ON \`_users_v_version_tenants\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_tenants_parent_id_idx\` ON \`_users_v_version_tenants\` (\`_parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_tenants_tenant_idx\` ON \`_users_v_version_tenants\` (\`tenant_id\`);`
	)
	await db.run(sql`CREATE TABLE \`_users_v_version_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_uuid\` text NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	\`refresh_count\` numeric,
  	\`refreshed_at\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_users_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_sessions_order_idx\` ON \`_users_v_version_sessions\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_sessions_parent_id_idx\` ON \`_users_v_version_sessions\` (\`_parent_id\`);`
	)
	await db.run(sql`CREATE TABLE \`_users_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version_email\` text NOT NULL,
  	\`version_reset_password_token\` text,
  	\`version_reset_password_expiration\` text,
  	\`version_salt\` text,
  	\`version_hash\` text,
  	\`version_reset_password_requested_at\` text,
  	\`version_login_attempts\` numeric DEFAULT 0,
  	\`version_lock_until\` text,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
	await db.run(sql`CREATE INDEX \`_users_v_parent_idx\` ON \`_users_v\` (\`parent_id\`);`)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_version_updated_at_idx\` ON \`_users_v\` (\`version_updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_version_created_at_idx\` ON \`_users_v\` (\`version_created_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_users_v_version_version_email_idx\` ON \`_users_v\` (\`version_email\`);`
	)
	await db.run(sql`CREATE INDEX \`_users_v_created_at_idx\` ON \`_users_v\` (\`created_at\`);`)
	await db.run(sql`CREATE INDEX \`_users_v_updated_at_idx\` ON \`_users_v\` (\`updated_at\`);`)
	await db.run(sql`CREATE TABLE \`_users_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_users_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`_users_v_rels_order_idx\` ON \`_users_v_rels\` (\`order\`);`)
	await db.run(sql`CREATE INDEX \`_users_v_rels_parent_idx\` ON \`_users_v_rels\` (\`parent_id\`);`)
	await db.run(sql`CREATE INDEX \`_users_v_rels_path_idx\` ON \`_users_v_rels\` (\`path\`);`)
	await db.run(
		sql`CREATE INDEX \`_users_v_rels_users_id_idx\` ON \`_users_v_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`pages_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`pages_rels_order_idx\` ON \`pages_rels\` (\`order\`);`)
	await db.run(sql`CREATE INDEX \`pages_rels_parent_idx\` ON \`pages_rels\` (\`parent_id\`);`)
	await db.run(sql`CREATE INDEX \`pages_rels_path_idx\` ON \`pages_rels\` (\`path\`);`)
	await db.run(sql`CREATE INDEX \`pages_rels_users_id_idx\` ON \`pages_rels\` (\`users_id\`);`)
	await db.run(sql`CREATE TABLE \`_pages_v_blocks_cta\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`heading\` text,
  	\`label\` text DEFAULT 'Book a demo' NOT NULL,
  	\`goal\` text NOT NULL,
  	\`_uuid\` text,
  	\`block_name\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_pages_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`_pages_v_blocks_cta_order_idx\` ON \`_pages_v_blocks_cta\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_pages_v_blocks_cta_parent_id_idx\` ON \`_pages_v_blocks_cta\` (\`_parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_pages_v_blocks_cta_path_idx\` ON \`_pages_v_blocks_cta\` (\`_path\`);`
	)
	await db.run(sql`CREATE TABLE \`_pages_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_title\` text,
  	\`version_slug\` text NOT NULL,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
	await db.run(sql`CREATE INDEX \`_pages_v_parent_idx\` ON \`_pages_v\` (\`parent_id\`);`)
	await db.run(
		sql`CREATE INDEX \`_pages_v_version_version_updated_at_idx\` ON \`_pages_v\` (\`version_updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_pages_v_version_version_created_at_idx\` ON \`_pages_v\` (\`version_created_at\`);`
	)
	await db.run(sql`CREATE INDEX \`_pages_v_created_at_idx\` ON \`_pages_v\` (\`created_at\`);`)
	await db.run(sql`CREATE INDEX \`_pages_v_updated_at_idx\` ON \`_pages_v\` (\`updated_at\`);`)
	await db.run(sql`CREATE TABLE \`_pages_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_pages_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`_pages_v_rels_order_idx\` ON \`_pages_v_rels\` (\`order\`);`)
	await db.run(sql`CREATE INDEX \`_pages_v_rels_parent_idx\` ON \`_pages_v_rels\` (\`parent_id\`);`)
	await db.run(sql`CREATE INDEX \`_pages_v_rels_path_idx\` ON \`_pages_v_rels\` (\`path\`);`)
	await db.run(
		sql`CREATE INDEX \`_pages_v_rels_users_id_idx\` ON \`_pages_v_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`tenants_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`tenants_rels_order_idx\` ON \`tenants_rels\` (\`order\`);`)
	await db.run(sql`CREATE INDEX \`tenants_rels_parent_idx\` ON \`tenants_rels\` (\`parent_id\`);`)
	await db.run(sql`CREATE INDEX \`tenants_rels_path_idx\` ON \`tenants_rels\` (\`path\`);`)
	await db.run(sql`CREATE INDEX \`tenants_rels_users_id_idx\` ON \`tenants_rels\` (\`users_id\`);`)
	await db.run(sql`CREATE TABLE \`_tenants_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_name\` text NOT NULL,
  	\`version_slug\` text NOT NULL,
  	\`version_timezone\` text DEFAULT 'America/New_York',
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
	await db.run(sql`CREATE INDEX \`_tenants_v_parent_idx\` ON \`_tenants_v\` (\`parent_id\`);`)
	await db.run(
		sql`CREATE INDEX \`_tenants_v_version_version_slug_idx\` ON \`_tenants_v\` (\`version_slug\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_tenants_v_version_version_updated_at_idx\` ON \`_tenants_v\` (\`version_updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_tenants_v_version_version_created_at_idx\` ON \`_tenants_v\` (\`version_created_at\`);`
	)
	await db.run(sql`CREATE INDEX \`_tenants_v_created_at_idx\` ON \`_tenants_v\` (\`created_at\`);`)
	await db.run(sql`CREATE INDEX \`_tenants_v_updated_at_idx\` ON \`_tenants_v\` (\`updated_at\`);`)
	await db.run(sql`CREATE TABLE \`_tenants_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_tenants_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`_tenants_v_rels_order_idx\` ON \`_tenants_v_rels\` (\`order\`);`)
	await db.run(
		sql`CREATE INDEX \`_tenants_v_rels_parent_idx\` ON \`_tenants_v_rels\` (\`parent_id\`);`
	)
	await db.run(sql`CREATE INDEX \`_tenants_v_rels_path_idx\` ON \`_tenants_v_rels\` (\`path\`);`)
	await db.run(
		sql`CREATE INDEX \`_tenants_v_rels_users_id_idx\` ON \`_tenants_v_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`offers_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`offers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`offers_rels_order_idx\` ON \`offers_rels\` (\`order\`);`)
	await db.run(sql`CREATE INDEX \`offers_rels_parent_idx\` ON \`offers_rels\` (\`parent_id\`);`)
	await db.run(sql`CREATE INDEX \`offers_rels_path_idx\` ON \`offers_rels\` (\`path\`);`)
	await db.run(sql`CREATE INDEX \`offers_rels_users_id_idx\` ON \`offers_rels\` (\`users_id\`);`)
	await db.run(sql`CREATE TABLE \`_offers_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_tenant_id\` integer,
  	\`version_title\` text NOT NULL,
  	\`version_slug\` text NOT NULL,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`offers\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
	await db.run(sql`CREATE INDEX \`_offers_v_parent_idx\` ON \`_offers_v\` (\`parent_id\`);`)
	await db.run(
		sql`CREATE INDEX \`_offers_v_version_version_tenant_idx\` ON \`_offers_v\` (\`version_tenant_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_offers_v_version_version_updated_at_idx\` ON \`_offers_v\` (\`version_updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`_offers_v_version_version_created_at_idx\` ON \`_offers_v\` (\`version_created_at\`);`
	)
	await db.run(sql`CREATE INDEX \`_offers_v_created_at_idx\` ON \`_offers_v\` (\`created_at\`);`)
	await db.run(sql`CREATE INDEX \`_offers_v_updated_at_idx\` ON \`_offers_v\` (\`updated_at\`);`)
	await db.run(sql`CREATE TABLE \`_offers_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_offers_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(sql`CREATE INDEX \`_offers_v_rels_order_idx\` ON \`_offers_v_rels\` (\`order\`);`)
	await db.run(
		sql`CREATE INDEX \`_offers_v_rels_parent_idx\` ON \`_offers_v_rels\` (\`parent_id\`);`
	)
	await db.run(sql`CREATE INDEX \`_offers_v_rels_path_idx\` ON \`_offers_v_rels\` (\`path\`);`)
	await db.run(
		sql`CREATE INDEX \`_offers_v_rels_users_id_idx\` ON \`_offers_v_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`analytics_providers_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`analytics_providers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_rels_order_idx\` ON \`analytics_providers_rels\` (\`order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_rels_parent_idx\` ON \`analytics_providers_rels\` (\`parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_rels_path_idx\` ON \`analytics_providers_rels\` (\`path\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_providers_rels_users_id_idx\` ON \`analytics_providers_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`analytics_goals_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`analytics_goals\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`analytics_goals_rels_order_idx\` ON \`analytics_goals_rels\` (\`order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_goals_rels_parent_idx\` ON \`analytics_goals_rels\` (\`parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_goals_rels_path_idx\` ON \`analytics_goals_rels\` (\`path\`);`
	)
	await db.run(
		sql`CREATE INDEX \`analytics_goals_rels_users_id_idx\` ON \`analytics_goals_rels\` (\`users_id\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_llm_instructions\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`entity_slug\` text NOT NULL,
  	\`entity_type\` text NOT NULL,
  	\`additional_instructions\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_entity_slug_idx\` ON \`payload_llm_instructions\` (\`entity_slug\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_updated_at_idx\` ON \`payload_llm_instructions\` (\`updated_at\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_created_at_idx\` ON \`payload_llm_instructions\` (\`created_at\`);`
	)
	await db.run(sql`CREATE TABLE \`payload_llm_instructions_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` text NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_llm_instructions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_rels_order_idx\` ON \`payload_llm_instructions_rels\` (\`order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_rels_parent_idx\` ON \`payload_llm_instructions_rels\` (\`parent_id\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_rels_path_idx\` ON \`payload_llm_instructions_rels\` (\`path\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_llm_instructions_rels_users_id_idx\` ON \`payload_llm_instructions_rels\` (\`users_id\`);`
	)
	await db.run(sql`DROP INDEX \`payload_jobs_processing_idx\`;`)
	await db.run(sql`ALTER TABLE \`payload_jobs\` ADD \`processing_until\` text;`)
	await db.run(sql`ALTER TABLE \`payload_jobs\` ADD \`processing_token\` text;`)
	await db.run(sql`ALTER TABLE \`payload_jobs\` ADD \`concurrency_key\` text;`)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_processing_until_idx\` ON \`payload_jobs\` (\`processing_until\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_concurrency_key_idx\` ON \`payload_jobs\` (\`concurrency_key\`);`
	)
	await db.run(sql`ALTER TABLE \`payload_jobs\` DROP COLUMN \`processing\`;`)
	await db.run(sql`PRAGMA foreign_keys=OFF;`)
	await db.run(sql`CREATE TABLE \`__new_payload_jobs_log\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`executed_at\` text NOT NULL,
  	\`completed_at\` text NOT NULL,
  	\`task_slug\` text NOT NULL,
  	\`task_i_d\` text NOT NULL,
  	\`input\` text NOT NULL,
  	\`output\` text,
  	\`state\` text NOT NULL,
  	\`error\` text,
  	\`parent_task_slug\` text,
  	\`parent_task_i_d\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`payload_jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
	// Edited by hand: drizzle-kit copied the two new parent_task columns from the old table, which
	// has neither yet. The new table starts them empty.
	await db.run(
		sql`INSERT INTO \`__new_payload_jobs_log\`("_order", "_parent_id", "id", "executed_at", "completed_at", "task_slug", "task_i_d", "input", "output", "state", "error") SELECT "_order", "_parent_id", "id", "executed_at", "completed_at", "task_slug", "task_i_d", "input", "output", "state", "error" FROM \`payload_jobs_log\`;`
	)
	await db.run(sql`DROP TABLE \`payload_jobs_log\`;`)
	await db.run(sql`ALTER TABLE \`__new_payload_jobs_log\` RENAME TO \`payload_jobs_log\`;`)
	await db.run(sql`PRAGMA foreign_keys=ON;`)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_log_order_idx\` ON \`payload_jobs_log\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_log_parent_id_idx\` ON \`payload_jobs_log\` (\`_parent_id\`);`
	)
	await db.run(sql`ALTER TABLE \`users_sessions\` ADD \`refresh_count\` numeric;`)
	await db.run(sql`ALTER TABLE \`users_sessions\` ADD \`refreshed_at\` text;`)
	await db.run(sql`ALTER TABLE \`users\` ADD \`reset_password_requested_at\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
	await db.run(sql`DROP TABLE \`users_rels\`;`)
	await db.run(sql`DROP TABLE \`_users_v_version_tenants\`;`)
	await db.run(sql`DROP TABLE \`_users_v_version_sessions\`;`)
	await db.run(sql`DROP TABLE \`_users_v\`;`)
	await db.run(sql`DROP TABLE \`_users_v_rels\`;`)
	await db.run(sql`DROP TABLE \`pages_rels\`;`)
	await db.run(sql`DROP TABLE \`_pages_v_blocks_cta\`;`)
	await db.run(sql`DROP TABLE \`_pages_v\`;`)
	await db.run(sql`DROP TABLE \`_pages_v_rels\`;`)
	await db.run(sql`DROP TABLE \`tenants_rels\`;`)
	await db.run(sql`DROP TABLE \`_tenants_v\`;`)
	await db.run(sql`DROP TABLE \`_tenants_v_rels\`;`)
	await db.run(sql`DROP TABLE \`offers_rels\`;`)
	await db.run(sql`DROP TABLE \`_offers_v\`;`)
	await db.run(sql`DROP TABLE \`_offers_v_rels\`;`)
	await db.run(sql`DROP TABLE \`analytics_providers_rels\`;`)
	await db.run(sql`DROP TABLE \`analytics_goals_rels\`;`)
	await db.run(sql`DROP TABLE \`payload_llm_instructions\`;`)
	await db.run(sql`DROP TABLE \`payload_llm_instructions_rels\`;`)
	await db.run(sql`DROP INDEX \`payload_jobs_processing_until_idx\`;`)
	await db.run(sql`DROP INDEX \`payload_jobs_concurrency_key_idx\`;`)
	await db.run(sql`ALTER TABLE \`payload_jobs\` ADD \`processing\` integer DEFAULT false;`)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_processing_idx\` ON \`payload_jobs\` (\`processing\`);`
	)
	await db.run(sql`ALTER TABLE \`payload_jobs\` DROP COLUMN \`processing_until\`;`)
	await db.run(sql`ALTER TABLE \`payload_jobs\` DROP COLUMN \`processing_token\`;`)
	await db.run(sql`ALTER TABLE \`payload_jobs\` DROP COLUMN \`concurrency_key\`;`)
	await db.run(sql`PRAGMA foreign_keys=OFF;`)
	await db.run(sql`CREATE TABLE \`__new_payload_jobs_log\` (
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
		sql`INSERT INTO \`__new_payload_jobs_log\`("_order", "_parent_id", "id", "executed_at", "completed_at", "task_slug", "task_i_d", "input", "output", "state", "error") SELECT "_order", "_parent_id", "id", "executed_at", "completed_at", "task_slug", "task_i_d", "input", "output", "state", "error" FROM \`payload_jobs_log\`;`
	)
	await db.run(sql`DROP TABLE \`payload_jobs_log\`;`)
	await db.run(sql`ALTER TABLE \`__new_payload_jobs_log\` RENAME TO \`payload_jobs_log\`;`)
	await db.run(sql`PRAGMA foreign_keys=ON;`)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_log_order_idx\` ON \`payload_jobs_log\` (\`_order\`);`
	)
	await db.run(
		sql`CREATE INDEX \`payload_jobs_log_parent_id_idx\` ON \`payload_jobs_log\` (\`_parent_id\`);`
	)
	await db.run(sql`ALTER TABLE \`users_sessions\` DROP COLUMN \`refresh_count\`;`)
	await db.run(sql`ALTER TABLE \`users_sessions\` DROP COLUMN \`refreshed_at\`;`)
	await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`reset_password_requested_at\`;`)
}
