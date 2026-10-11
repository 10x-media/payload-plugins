import type { PayloadRequest } from 'payload'
import type { DimensionKey, MetricKey } from '../core/contract'
import { type AnalyticsRuntime, goalNamesFor, resolveGoalsDetailedFor } from './runtime'

/** The slice of a read that decides whether it is about goals. */
export interface GoalRead {
	metrics: MetricKey[]
	dimensions?: DimensionKey[]
}

interface GoalSlugsArgs extends GoalRead {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The read's own scope; goals are resolved per scope. */
	scope: string | null | undefined
}

const needsGoalHint = (read: GoalRead): boolean =>
	read.metrics.includes('conversions') || (read.dimensions ?? []).includes('goal')

interface ResolvedGoalHint {
	/** Every slug the read restricts to, the latent built-in goal included. */
	slugs: string[] | 'unresolved'
	/**
	 * Which of those slugs the install did not declare: the built-in `purchase` goal, which
	 * counts at ingest but is not a goal a report may list until it has conversions.
	 */
	builtin: string[]
	/**
	 * Every resolved goal's name, so a report lists a goal by name rather than by its slug; for a
	 * read spanning every scope, the names of every scope's goals the reader may see.
	 */
	names: Array<{ slug: string; name: string }>
}

/**
 * Goal hint for a read about goals, else undefined. A throwing resolver hints `'unresolved'`, which
 * is never cached as healthy nor mistaken for an install with no goals.
 */
export const goalHintFor = async (args: GoalSlugsArgs): Promise<ResolvedGoalHint | undefined> => {
	if (!needsGoalHint(args)) {
		return undefined
	}
	try {
		const goals = await resolveGoalsDetailedFor(args.runtime, args.req, args.scope)
		const names = await goalNamesFor({ ...args, resolved: goals })
		return {
			slugs: goals.map(({ goal }) => goal.slug),
			builtin: goals.filter((entry) => entry.source === 'builtin').map(({ goal }) => goal.slug),
			names,
		}
	} catch (err) {
		args.req.payload.logger?.warn(`analytics: goal slugs failed to resolve: ${String(err)}`)
		return { slugs: 'unresolved', builtin: [], names: [] }
	}
}

/** The hint's slugs alone, for a caller that never lists goal rows of its own. */
export const goalSlugsFor = async (
	args: GoalSlugsArgs
): Promise<string[] | 'unresolved' | undefined> => (await goalHintFor(args))?.slugs
