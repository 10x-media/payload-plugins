import type { PayloadHandler } from 'payload'
import { analyticsError, errorResponse, NO_STORE } from '../plugin/errors'
import { GOALS_PATH } from '../plugin/paths'
import {
	getRuntime,
	platformReadFor,
	readAccessFor,
	resolveGoalsDetailedFor,
	resolveScopeFor,
} from '../plugin/runtime'
import type { GoalsResponse, WireGoal } from './fetchGoals'

export type { GoalsResponse, WireGoal }
export { GOALS_PATH }

/**
 * Authenticated GET listing the goals visible to the requesting scope, gated by
 * `access.read` like every other read endpoint: the config goals
 * merged with the goals collection, each tagged with where it came from. Scope gating
 * mirrors the sources endpoint exactly, because the reasoning is the same: there is no
 * scope parameter, so a tenant can never enumerate another tenant's goals; on a scoped
 * install a request that resolves no scope is ambiguous rather than install-wide and
 * answers empty unless `platformRead` grants it; and a failed resolution on a scoped
 * install is indistinguishable from a forged one, so it answers empty too, while an
 * unscoped install falls back to the static config goals.
 *
 * Every answer is `no-store`: which goals a caller sees depends on its own scope.
 */
export const makeGoalsHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return errorResponse(401, analyticsError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return Response.json({ goals: [], collection: null } satisfies GoalsResponse, {
			headers: NO_STORE,
		})
	}
	if (!(await readAccessFor(runtime, req))) {
		return errorResponse(403, analyticsError('forbidden', 'analytics: read access denied'))
	}
	const collection = runtime.goalsCollectionSlug ? { slug: runtime.goalsCollectionSlug } : null
	const configGoals = (): WireGoal[] =>
		(runtime.goals ?? []).map((goal) => ({
			slug: goal.slug,
			name: goal.name,
			source: 'config' as const,
		}))
	try {
		const scope = await resolveScopeFor(runtime, req)
		if (runtime.scoped && scope === null && !(await platformReadFor(runtime, req))) {
			return Response.json({ goals: [], collection } satisfies GoalsResponse, { headers: NO_STORE })
		}
		const resolved = await resolveGoalsDetailedFor(runtime, req, scope)
		const goals = resolved.map(({ goal, source }) => ({
			slug: goal.slug,
			name: goal.name,
			source,
		}))
		return Response.json({ goals, collection } satisfies GoalsResponse, { headers: NO_STORE })
	} catch (err) {
		req.payload.logger?.warn(`analytics: goals listing failed: ${String(err)}`)
		return Response.json(
			{
				goals: runtime.scoped ? [] : configGoals(),
				collection,
			} satisfies GoalsResponse,
			{ headers: NO_STORE }
		)
	}
}
