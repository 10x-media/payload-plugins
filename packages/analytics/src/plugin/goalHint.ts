import type { PayloadRequest } from 'payload'
import type { DimensionKey, MetricKey } from '../core/contract'
import { type AnalyticsRuntime, resolveGoalsFor } from './runtime'

/** What a read asks for, which is all the hint needs to know whether goals are involved. */
export interface GoalRead {
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
 * read, which no adapter restricts. An empty list is an install with no goals, which reads
 * as an empty result; a resolver that throws hints `'unresolved'` instead, so the read
 * costs only its goal rows (the provider answers `goalsUnresolved`) and is neither cached
 * as a healthy answer nor mistaken for an install that configured nothing.
 */
export const goalSlugsFor = async (
	args: GoalSlugsArgs
): Promise<string[] | 'unresolved' | undefined> => {
	if (!needsGoalHint(args)) {
		return undefined
	}
	try {
		const goals = await resolveGoalsFor(args.runtime, args.req, args.scope)
		return goals.map((goal) => goal.slug)
	} catch (err) {
		args.req.payload.logger?.warn(`analytics: goal slugs failed to resolve: ${String(err)}`)
		return 'unresolved'
	}
}
