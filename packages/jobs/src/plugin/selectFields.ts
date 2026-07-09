import type { Condition, Config, Field } from 'payload'

export type JobSelectSlugs = { queues: string[]; tasks: string[]; workflows: string[] }

/**
 * Slugs available for the create-form selects, read from the assembled config.
 * Queues union every statically declarable source: the plugin's `queues` option
 * and queue-control queues (passed in as `extraQueues`), static `autoRun`
 * entries, task and workflow `schedule[].queue`, and workflow-level `queue`.
 * `autoRun` may be a function (resolved at runtime); those queues are skipped.
 */
export const collectJobSelectSlugs = (
	config: Config,
	extraQueues: string[] = []
): JobSelectSlugs => {
	const taskConfigs = config.jobs?.tasks ?? []
	const workflowConfigs = config.jobs?.workflows ?? []
	const autoRun = Array.isArray(config.jobs?.autoRun) ? config.jobs.autoRun : []
	const scheduleQueues = [...taskConfigs, ...workflowConfigs].flatMap((entry) =>
		(entry.schedule ?? []).map((schedule) => schedule.queue)
	)
	const workflowQueues = workflowConfigs.flatMap((workflow) =>
		workflow.queue ? [workflow.queue] : []
	)
	const queues = [
		...new Set([
			'default',
			...extraQueues,
			...autoRun.flatMap((cron) => (cron.queue ? [cron.queue] : [])),
			...scheduleQueues,
			...workflowQueues,
		]),
	]
	return {
		queues,
		tasks: taskConfigs.map((task) => task.slug),
		workflows: workflowConfigs.map((workflow) => workflow.slug),
	}
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
