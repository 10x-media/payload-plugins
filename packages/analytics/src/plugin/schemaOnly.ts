import type { CollectionConfig, Config, TaskConfig } from 'payload'
import { type ScheduledTask, TASK_SLUGS } from '../core/jobs'
import type { ResolvedOptions } from '../core/options'
import type { TranslationsOption } from '../translations'
import { restrictJobControls } from './jobsAccess'
import { addStateCollection, type CollectionContext, cacheCollectionOf } from './pluginCollections'
import { registerTranslations } from './registerTranslations'
import { relabelFactoryFields } from './relabelFields'
import { fillUnbundledLanguages } from './unbundledLanguages'

type JobsTask = NonNullable<NonNullable<Config['jobs']>['tasks']>[number]

export const addTask = (config: Config, task: JobsTask): void => {
	config.jobs = { ...config.jobs, tasks: [...(config.jobs?.tasks ?? []), task] }
}

const scheduleForSchema = (schedule: ScheduledTask): Pick<TaskConfig, 'schedule'> =>
	schedule.cron === null
		? {}
		: {
				schedule: [
					{
						cron: schedule.cron,
						queue: schedule.queue,
						hooks: {
							beforeSchedule: () => ({ shouldSchedule: false }),
							afterSchedule: () => undefined,
						},
					},
				],
			}

/**
 * A task slug a switched-off install keeps in its jobs enum. Its handler does nothing, and its
 * schedule, kept so Payload keeps `payload-jobs-stats`, never queues a run.
 */
export const schemaOnlyTask = (
	slug: string,
	schedule: ScheduledTask
): TaskConfig<{ input: Record<string, never>; output: Record<string, never> }> => ({
	slug,
	retries: 0,
	handler: async () => ({ output: {} }),
	...scheduleForSchema(schedule),
})

interface SchemaOnlyArgs {
	resolved: ResolvedOptions
	/** The providers and goals collections, built as the running plugin builds them. */
	collections: CollectionConfig[]
	/** The sync collection when sync is on, built as the running plugin builds it. */
	sync?: CollectionConfig
	/** The database the collections are checked against; their notices are never said. */
	context: CollectionContext
	translations?: TranslationsOption
}

/**
 * `disabled: true`: the running plugin's schema and nothing that runs, with the same collections
 * and task slugs, inert and unscheduled. Job controls stay restricted, its only `onInit`.
 */
export const schemaOnly = (config: Config, args: SchemaOnlyArgs): Config => {
	const { resolved, context } = args
	const { jobs } = resolved
	config.collections = [...(config.collections ?? []), ...args.collections]
	for (const adapter of resolved.adapters) {
		adapter.registerSchema?.(config, { jobs, notice: context.notice })
	}
	if (jobs !== false && resolved.cache.warm.enabled) {
		addTask(config, schemaOnlyTask(TASK_SLUGS.warm, jobs.warm))
	}
	if (args.sync) {
		config.collections = [...(config.collections ?? []), args.sync]
		if (jobs !== false) {
			addTask(config, schemaOnlyTask(TASK_SLUGS.sync, jobs.sync))
		}
	}
	const cache = cacheCollectionOf(resolved, context)
	if (cache) {
		config.collections = [...(config.collections ?? []), cache]
	}
	addStateCollection(config, resolved, context)
	restrictJobControls(config)
	relabelFactoryFields(config, context.staticLabel)
	if (args.collections.length > 0 || args.sync) {
		registerTranslations(config, args.translations)
		fillUnbundledLanguages(config)
	}
	return config
}
