import { GOALS_PATH } from '../plugin/paths'
import type { GoalSource } from './resolver'

export interface WireGoal {
	slug: string
	name: string
	source: GoalSource
}

export interface GoalsResponse {
	goals: WireGoal[]
	/** The goals collection, when the install enabled it, so a picker can link to it. */
	collection: { slug: string } | null
}

const cache = new Map<string, Promise<GoalsResponse>>()

/**
 * Fetch the caller-scope goal list once per user per admin session and share it between
 * every picker on the page (a document can carry several goal fields). A failed fetch
 * clears its cache entry so a later mount retries instead of pinning the error, and the
 * user id in the key keeps a soft-navigation logout/login from serving the previous
 * user's goals.
 */
export const fetchGoals = (
	serverURL: string,
	apiRoute: string,
	userKey: string
): Promise<GoalsResponse> => {
	const url = `${serverURL}${apiRoute}${GOALS_PATH}`
	const key = `${userKey}:${url}`
	const hit = cache.get(key)
	if (hit) return hit
	const pending = fetch(url, { credentials: 'include' })
		.then((res) => {
			if (!res.ok) throw new Error(`goals ${res.status}`)
			return res.json() as Promise<GoalsResponse>
		})
		.catch((err) => {
			cache.delete(key)
			throw err
		})
	cache.set(key, pending)
	return pending
}
