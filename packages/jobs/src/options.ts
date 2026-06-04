import type { CollectionConfig, Field, PayloadComponent } from 'payload'

import type { Override } from './plugin/resolve'
import type { QueueControlOptions } from './queueControl/options'
import type { ReliabilityOptions } from './reliability/options'

/** Replace the default fields, or transform them (the idiomatic Payload form). */
export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

/**
 * Override slot for a collection this plugin builds. Spread over our defaults,
 * so any collection key can be replaced; `fields` additionally accepts a
 * function that receives our default fields to compose with.
 */
export type CollectionOverride = { fields?: FieldsOverride } & Partial<
	Omit<CollectionConfig, 'fields'>
>

/** Improvements applied to Payload's built-in `payload-jobs` collection. */
export type JobsOptions = {
	/** Show the jobs collection in the admin. Defaults to visible (un-hidden). */
	hidden?: boolean
	/** List columns for the jobs collection; replace or transform our defaults. */
	defaultColumns?: Override<string[]>
	/**
	 * Treat an existing job as a read-only record (default `true`): execution-state
	 * fields are surfaced in the header and locked, inputs are editable only on
	 * Create. Set `false` to leave every field editable. Never disables Create.
	 */
	readOnlyRecord?: boolean
	/**
	 * Per-field list-cell overrides, keyed by job field name. `false` keeps
	 * Payload's default cell; a component replaces it.
	 */
	cells?: Record<string, PayloadComponent | false>
	/** The derived Status column. `false` removes it; a component replaces our status cell. */
	status?: PayloadComponent | false
	/**
	 * Components rendered between the search bar and the table. `false` removes our
	 * queue-health bar; an array replaces it.
	 */
	beforeListTable?: PayloadComponent[] | false
	/**
	 * Per-status cap for the queue-health bar: counts above it render as `${cap}+`.
	 * Defaults to 100; `false` shows the exact count.
	 */
	healthBarCap?: false | number
}

/**
 * Options for the jobs plugin. Improves the built-in `payload-jobs` collection;
 * set `disabled` to leave the incoming config untouched.
 */
export type JobsPluginOptions = JobsOptions & {
	/** Disable the plugin entirely (incoming config returned untouched). */
	disabled?: boolean
	/**
	 * Reliability layer: stuck-job recovery, a heartbeat lease, and multi-node
	 * leader election. Off by default; pass `true` for defaults or an object to
	 * tune it. It adds fields to `payload-jobs` and a `payload-jobs-locks`
	 * collection, so adopters run one `migrate:create`.
	 */
	reliability?: boolean | ReliabilityOptions
	/**
	 * Queue control: pause/resume, a status endpoint, and a hardened run endpoint.
	 * Off by default; pass `true` for defaults or an object to tune it.
	 */
	queueControl?: boolean | QueueControlOptions
}
