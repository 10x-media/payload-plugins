import type { PayloadRequest } from 'payload'
import type { DimensionKey, MetricKey } from '../core/contract'
import { type AnalyticsRuntime, resolveGoalsFor } from './runtime'

interface GoalRead {
	metrics: MetricKey[]
	dimensions?: DimensionKey[]
}

export interface GoalSlugsArgs extends GoalRead {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The read's own scope; goals are resolved per scope. */
	scope: string | null | undefined
}

/** A read whose numbers are goal completions: the `goal` breakdown, or the `conversions` metric. */
export const needsGoalHint = (read: GoalRead): boolean =>
	read.metrics.includes('conversions') || (read.dimensions ?? []).includes('goal')

/**
 * The scope's goal slugs for a read that asks about goals, and undefined for every other
 * read, which no adapter restricts. A resolver that throws costs the read its goal rows
 * (the provider answers `goalsUnresolved`), never the read itself.
 */
export const goalSlugsFor = async (args: GoalSlugsArgs): Promise<string[] | undefined> => {
	if (!needsGoalHint(args)) {
		return undefined
	}
	try {
		const goals = await resolveGoalsFor(args.runtime, args.req, args.scope)
		return goals.map((goal) => goal.slug)
	} catch (err) {
		args.req.payload.logger?.warn(`analytics: goal slugs failed to resolve: ${String(err)}`)
		return []
	}
}
