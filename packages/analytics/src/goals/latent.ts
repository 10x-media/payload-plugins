import type { MetricValue } from '../core/contract'

// Built-in `purchase` always matches but is no goal the install has: a report treating it as one
// would tell a site that sells nothing it has a goal, at zero, forever.

/** True when the hint carries nothing the install itself declared. */
export const hasNoDeclaredGoals = (
	slugs: readonly string[],
	builtinSlugs: readonly string[] | undefined
): boolean => slugs.every((slug) => (builtinSlugs ?? []).includes(slug))

/** True for a built-in goal's row before it has a single conversion: not a row, yet. */
export const isLatentGoalRow = (
	slug: string,
	conversions: MetricValue | undefined,
	builtinSlugs: readonly string[] | undefined
): boolean => (builtinSlugs ?? []).includes(slug) && !conversions
