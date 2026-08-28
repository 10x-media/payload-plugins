import type { CollectionConfig, Field, PayloadComponent } from 'payload'
import type { JobInputComponents } from './jobs/inputComponents'
import type { JobInputExamples } from './jobs/inputPlaceholders'
import type { JobLogEntryComponents } from './jobs/logSlotComponents'
import type { Override } from './plugin/resolve'
import type { QueueControlOptions } from './queueControl/options'
import type { ReliabilityOptions } from './reliability/options'
import type { TranslationsOption } from './translations'

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
	 * Custom renderers for the JSON blocks inside an expanded log-attempt row.
	 * `entryComponents` is keyed by task slug (`'*'` for every task, `inline` for
	 * Payload's reserved inline steps) and then by block; unset blocks keep the
	 * default JSON dump. A registered block also renders for an empty value (an
	 * attempt that returned `{}`), but never for a value the attempt does not
	 * carry at all, so a succeeded attempt gets no error block. Paths are
	 * registered with `admin.dependencies`, so adopters re-run
	 * `payload generate:importmap` after changing them.
	 */
	log?: { entryComponents?: JobLogEntryComponents }
	/**
	 * The job's `input` on the create form. `examples` merges hand-written values
	 * over the placeholder derived from a slug's `inputSchema`, for values the
	 * derivation cannot invent. `components` swaps the JSON editor for a custom
	 * one per task or workflow slug (`'*'` for every slug, `false` to keep JSON);
	 * the placeholder still applies, and the editor reads and writes the field
	 * through `useField`. Paths are registered with `admin.dependencies`, so
	 * adopters re-run `payload generate:importmap` after changing them.
	 */
	input?: { components?: JobInputComponents; examples?: JobInputExamples }
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
	/**
	 * Extra queue names offered by the admin queue select, independent of
	 * queueControl. Queues named in task/workflow schedules, workflow `queue`,
	 * and static autoRun entries are discovered automatically.
	 */
	queues?: string[]
}

/**
 * Options for the jobs plugin. Improves the built-in `payload-jobs` collection;
 * set `disabled` to leave the incoming config untouched.
 */
export type JobsPluginOptions = JobsOptions & {
	/** Disable the plugin entirely (incoming config returned untouched). */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/jobs/i18n`. Values win over the
	 * built-in locales key-by-key; locales the plugin does not ship are added
	 * whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
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
	/**
	 * Collection-level override for the enhanced `payload-jobs` collection,
	 * applied as the outermost layer (after reliability fields). `fields`
	 * receives the fully-enhanced defaults; hooks append after the plugin's.
	 */
	overrides?: { jobs?: CollectionOverride }
}
