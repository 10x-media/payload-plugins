import type { Condition, Config, Field } from 'payload'

export type JobSelectSlugs = { queues: string[]; tasks: string[]; workflows: string[] }

/**
 * Slugs available for the create-form selects, read from the assembled config.
 * `autoRun` may be a function (resolved at runtime), in which case its queues
 * cannot be known here and are skipped.
 */
export const collectJobSelectSlugs = (
	config: Config,
	queueControlQueues: string[] = []
): JobSelectSlugs => {
	const tasks = (config.jobs?.tasks ?? []).map((task) => task.slug)
	const workflows = (config.jobs?.workflows ?? []).map((workflow) => workflow.slug)
	const autoRun = Array.isArray(config.jobs?.autoRun) ? config.jobs.autoRun : []
	const autoRunQueues = autoRun.flatMap((cron) => (cron.queue ? [cron.queue] : []))
	const queues = [...new Set(['default', ...queueControlQueues, ...autoRunQueues])]
	return { queues, tasks, workflows }
}

/**
 * Recast a field as a native select over known slugs, with Payload-level
 * validation kept permissive so programmatic writes are never rejected there.
 * The db adapters still derive a hard enum from `options`, so callers must
 * pass every value the runner may write, not just what the UI should offer.
 */
export const jobSelectField = (field: Field, values: string[]): Field =>
	({
		...field,
		type: 'select',
		options: values.map((value) => ({ label: value, value })),
		validate: () => true,
	}) as Field

/** Existing select option values on a field merged with additional values, deduplicated. */
export const unionSelectValues = (field: Field, values: string[]): string[] => {
	const existing =
		field.type === 'select'
			? field.options.map((option) => (typeof option === 'object' ? option.value : option))
			: []
	return [...new Set([...existing, ...values])]
}

/** Workflow select: on create, shown while no task is chosen; on edit, only when set. */
export const workflowCondition =
	(optionCount: number): Condition =>
	(data, siblingData, { operation }) =>
		operation === 'create' ? optionCount > 0 && !siblingData?.taskSlug : Boolean(data?.workflowSlug)

/** Task select: mirror of `workflowCondition`. */
export const taskCondition =
	(optionCount: number): Condition =>
	(data, siblingData, { operation }) =>
		operation === 'create' ? optionCount > 0 && !siblingData?.workflowSlug : Boolean(data?.taskSlug)
