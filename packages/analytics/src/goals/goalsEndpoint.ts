import type { PayloadHandler } from 'payload'
import { readGate } from '../access/readGate'
import { PLATFORM_SCOPE } from '../core/contract'
import { resolveRequestedScope } from '../core/scopedRead'
import { analyticsError, errorResponse, NO_STORE } from '../plugin/errors'
import { getRuntime, resolveGoalsDetailedFor } from '../plugin/runtime'
import type { GoalsResponse, WireGoal } from './fetchGoals'
import type { ResolvedGoal } from './resolver'

export type { GoalsResponse, WireGoal }

const wireGoal = ({ goal, source }: ResolvedGoal): WireGoal => ({
	slug: goal.slug,
	name: goal.name,
	source,
})

const listing = (goals: WireGoal[], collection: GoalsResponse['collection']): Response =>
	Response.json({ goals, collection } satisfies GoalsResponse, { headers: NO_STORE })

/**
 * Authenticated GET listing the requested scope's goals, gated by `access.read`, never cached. There
 * is no scope parameter, so no tenant can enumerate another's goals by naming one.
 */
export const makeGoalsHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return errorResponse(401, analyticsError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return listing([], null)
	}
	let allowed: boolean
	try {
		allowed = await readGate(runtime, req)
	} catch (err) {
		// A gate that fails must not fall through to the degraded listing below, which answers 200.
		req.payload.logger?.error(`analytics: goals read access check failed: ${String(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: goals listing failed'))
	}
	if (!allowed) {
		return errorResponse(403, analyticsError('forbidden', 'analytics: read access denied'))
	}
	const collection = runtime.goalsCollectionSlug ? { slug: runtime.goalsCollectionSlug } : null
	const params = new URL(req.url ?? '', 'http://localhost').searchParams
	// Built-in `purchase` is latent: a picker offering it would offer a goal nobody declared.
	const includeBuiltin = params.get('include') === 'builtin'
	// A failed scoped resolution looks like a forged one, so only an unscoped install lists config goals.
	const degraded = (): Response =>
		listing(
			runtime.scoped
				? []
				: (runtime.goals ?? []).map((goal) => wireGoal({ goal, source: 'config' })),
			collection
		)
	try {
		const requested = await resolveRequestedScope({ runtime, req })
		if (!requested.ok) {
			if (requested.reason === 'not-member') {
				return errorResponse(
					400,
					analyticsError('untrusted_scope', 'analytics: scope is not permitted for this request')
				)
			}
			return requested.reason === 'failed' ? degraded() : listing([], collection)
		}
		const scope = requested.scope === PLATFORM_SCOPE ? null : requested.scope
		const resolved = runtime.listGoals
			? await runtime.listGoals(req, scope)
			: await resolveGoalsDetailedFor(runtime, req, scope)
		return listing(
			resolved.filter((entry) => includeBuiltin || entry.source !== 'builtin').map(wireGoal),
			collection
		)
	} catch (err) {
		req.payload.logger?.warn(`analytics: goals listing failed: ${String(err)}`)
		return degraded()
	}
}
