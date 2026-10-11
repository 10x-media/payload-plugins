/** What happens to a job an interruption stops mid-run. */
export type InterruptPolicy = 'defer' | 'fail'

const DEFER_MARK = Symbol.for('@10x-media/jobs:deferOnInterrupt')

type Entry = { slug: string; handler?: unknown }

const isMarked = (handler: unknown): boolean =>
	typeof handler === 'function' && (handler as { [DEFER_MARK]?: boolean })[DEFER_MARK] === true

/**
 * Opt a task or workflow into `defer`: interrupted mid-run, it goes back to the
 * queue until the interruption ends instead of failing for good. Only for jobs
 * that are safe to run again from the start; a workflow skips the steps it
 * already completed. Requires a function handler.
 *
 * @example
 * jobs: { tasks: [deferOnInterrupt({ slug: 'reindex', handler: reindex })] }
 */
export const deferOnInterrupt = <T extends Entry>(config: T): T => {
	const { handler } = config
	if (typeof handler !== 'function') {
		throw new Error(
			`@10x-media/jobs: deferOnInterrupt("${config.slug}") needs a function handler. List handlers registered by path in jobs({ interrupt: { defer } }) instead.`
		)
	}
	const marked = (...args: unknown[]) => handler(...args)
	Object.defineProperty(marked, DEFER_MARK, { value: true })
	return { ...config, handler: marked }
}

/** The slugs that defer, per kind: marked handlers plus the central list. */
export type DeferSlugs = { tasks: ReadonlySet<string>; workflows: ReadonlySet<string> }

export const resolveDeferSlugs = (
	tasks: readonly Entry[],
	workflows: readonly Entry[],
	central: readonly string[]
): DeferSlugs => {
	const pick = (entries: readonly Entry[]) =>
		new Set(
			entries
				.filter((entry) => isMarked(entry.handler) || central.includes(entry.slug))
				.map((entry) => entry.slug)
		)
	return { tasks: pick(tasks), workflows: pick(workflows) }
}

/**
 * A job's policy. A workflow's covers every task it runs; a single-task job
 * takes its task's. Anything not opted in fails.
 */
export const policyFor = (
	job: { taskSlug?: string | null; workflowSlug?: string | null },
	defer: DeferSlugs
): InterruptPolicy => {
	if (job.workflowSlug) {
		return defer.workflows.has(job.workflowSlug) ? 'defer' : 'fail'
	}
	return job.taskSlug && defer.tasks.has(job.taskSlug) ? 'defer' : 'fail'
}
