import { readResponseError } from '../plugin/errors'
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
		.then(async (res) => {
			if (!res.ok) {
				// One failed state covers every refusal the picker can get, so the code rides in
				// the message rather than becoming a second state nothing would render.
				const code = (await readResponseError(res))?.code
				throw new Error(`analytics: goals ${res.status}${code ? ` ${code}` : ''}`)
			}
			return (await res.json()) as GoalsResponse
		})
		.catch((err) => {
			cache.delete(key)
			throw err
		})
	cache.set(key, pending)
	return pending
}
