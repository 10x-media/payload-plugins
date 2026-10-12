import type { TrackerGoal } from '../tracker/config'

export interface Goal extends TrackerGoal {
	/**
	 * Admin-facing label. Never leaves the server: the tracker config carries a goal's slug, match,
	 * value and currency alone.
	 */
	name: string
	/**
	 * `false` makes the goal server-only: native ingest ignores a browser's completion of it, so a
	 * request cannot forge one. Server code (`purchase`, `trackServerEvent`) still completes it.
	 */
	browser?: boolean
}

/** Kebab-case, so a slug is safe in a URL, a data attribute, and a daily total's key. */
export const GOAL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
