/**
 * How an incoming event is recognized as a completion of this goal. `goal` matches an
 * explicit `trackGoal(slug)` call, which is what the attribute and action hookups emit.
 */
export type GoalMatch =
	| { kind: 'event'; name: string }
	| { kind: 'path'; pattern: string }
	| { kind: 'goal' }

export interface Goal {
	/** Stable identifier, kebab-case; unique across the install's goals. */
	slug: string
	/** Admin-facing label. Never leaves the server: the tracker config carries slugs only. */
	name: string
	match: GoalMatch
	/** Revenue for one completion: a fixed amount, or read from an event property. */
	value?: { fixed?: number; prop?: string }
	/** ISO 4217 code the goal's value is denominated in. */
	currency?: string
}

/** The goal fields the browser tracker needs; `name` is admin-facing only. */
export type TrackerGoal = Pick<Goal, 'slug' | 'match' | 'value' | 'currency'>

/** Kebab-case, so a slug is safe in a URL, a data attribute, and a rollup bucket key. */
export const GOAL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
