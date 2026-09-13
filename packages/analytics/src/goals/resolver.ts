import type { PayloadRequest, Where } from 'payload'
import { GOAL_SLUG_PATTERN, type Goal, type GoalMatch } from './types'

export const GOALS_CACHE_TTL_MS = 30_000

/** Where a resolved goal came from; Task 2's endpoint shows it next to the goal. */
export type GoalSource = 'config' | 'collection'

export interface ResolvedGoal {
	goal: Goal
	source: GoalSource
}

export interface GoalsResolver {
	resolve: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
	resolveDetailed: (req: PayloadRequest, scope?: string | null) => Promise<ResolvedGoal[]>
	/** Drops every cached scope; wired to the goals collection's change hooks. */
	invalidate: () => void
}

/**
 * A scoped install stores install-wide goals with no scope at all, so a null scope has to
 * match both an absent field and an empty string (same shape the providers lookup uses).
 */
export const goalScopeWhere = (scopeField: string, scope: string | null): Where =>
	scope === null
		? { or: [{ [scopeField]: { equals: null } }, { [scopeField]: { equals: '' } }] }
		: { [scopeField]: { equals: scope } }

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value : undefined

const object = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined

const docToMatch = (value: unknown): GoalMatch | null => {
	const raw = object(value)
	switch (raw?.kind) {
		case 'goal':
			return { kind: 'goal' }
		case 'event': {
			const name = text(raw.name)
			return name ? { kind: 'event', name } : null
		}
		case 'path': {
			const pattern = text(raw.pattern)
			return pattern ? { kind: 'path', pattern } : null
		}
		default:
			return null
	}
}

/**
 * One goal document as the matcher sees it, or null when the document cannot produce a
 * usable goal. Editors can save a half-filled draft, so a document missing the part its
 * match kind needs is skipped rather than allowed to match everything or nothing.
 */
export const docToGoal = (doc: Record<string, unknown>): Goal | null => {
	if (doc.enabled === false) {
		return null
	}
	const slug = text(doc.slug)
	if (!slug || !GOAL_SLUG_PATTERN.test(slug)) {
		return null
	}
	const match = docToMatch(doc.match)
	if (!match) {
		return null
	}
	const raw = object(doc.value)
	const fixed = raw?.fixed
	if (fixed !== null && fixed !== undefined) {
		if (typeof fixed !== 'number' || !Number.isFinite(fixed) || fixed < 0) {
			return null
		}
	}
	const prop = text(raw?.prop)
	const value =
		typeof fixed === 'number' || prop
			? { ...(typeof fixed === 'number' ? { fixed } : {}), ...(prop ? { prop } : {}) }
			: undefined
	const currency = text(doc.currency)
	return {
		slug,
		name: text(doc.name) ?? slug,
		match,
		...(value ? { value } : {}),
		...(currency ? { currency } : {}),
	}
}

const mergeDetailed = (config: Goal[], collection: Goal[]): ResolvedGoal[] => {
	const bySlug = new Map<string, Goal>()
	for (const goal of collection) {
		if (!bySlug.has(goal.slug)) {
			bySlug.set(goal.slug, goal)
		}
	}
	const out: ResolvedGoal[] = []
	const taken = new Set<string>()
	for (const goal of config) {
		const override = bySlug.get(goal.slug)
		out.push(override ? { goal: override, source: 'collection' } : { goal, source: 'config' })
		taken.add(goal.slug)
	}
	for (const [slug, goal] of bySlug) {
		if (!taken.has(slug)) {
			out.push({ goal, source: 'collection' })
		}
	}
	return out
}

/**
 * Config order first, with a collection goal replacing the config goal of the same slug in
 * place, then the collection's own extras. Editors adjust what config declared without
 * reordering the reports built on it.
 */
export const mergeGoals = (config: Goal[], collection: Goal[]): Goal[] =>
	mergeDetailed(config, collection).map((entry) => entry.goal)

/** The resolver an install without the goals collection gets: config goals, no reads. */
export const configGoalsResolver = (config: Goal[]): GoalsResolver => {
	const detailed = mergeDetailed(config, [])
	return {
		resolve: async () => config,
		resolveDetailed: async () => detailed,
		invalidate: () => {},
	}
}

export interface CreateGoalsResolverArgs {
	slug: string
	scopeField: string
	/** True when the install configured a scopeResolver; unscoped installs ignore scope. */
	scoped: boolean
	config: Goal[]
	ttlMs?: number
	now?: () => number
}

/**
 * Merges the goals collection over the config goals, cached per scope for a short TTL so
 * ingest (which resolves goals on every event) does not query the collection per request.
 * Invalidation clears all scopes at once: a document's scope can itself change, so evicting
 * one scope could leave a stale entry under the other.
 */
export const createGoalsResolver = (args: CreateGoalsResolverArgs): GoalsResolver => {
	const ttlMs = args.ttlMs ?? GOALS_CACHE_TTL_MS
	const now = args.now ?? Date.now
	const configGoals = mergeDetailed(args.config, [])
	const cache = new Map<string, { goals: ResolvedGoal[]; expiresAt: number }>()

	const load = async (req: PayloadRequest, scope: string | null): Promise<ResolvedGoal[]> => {
		try {
			const { docs } = await req.payload.find({
				collection: args.slug as never,
				where: args.scoped
					? { and: [{ enabled: { equals: true } }, goalScopeWhere(args.scopeField, scope)] }
					: { enabled: { equals: true } },
				limit: 500,
				pagination: false,
				depth: 0,
				overrideAccess: true,
				req,
			})
			const goals: Goal[] = []
			for (const doc of docs as unknown as Array<Record<string, unknown>>) {
				const goal = docToGoal(doc)
				if (goal) {
					goals.push(goal)
				}
			}
			return mergeDetailed(args.config, goals)
		} catch (err) {
			// Goal matching must not take ingest down with the collection: config goals still
			// match, and the failed result is cached so a broken read is not retried per event.
			req.payload.logger?.warn?.(
				`analytics: goals collection read failed for scope "${scope ?? ''}", falling back to config goals: ${String(err)}`
			)
			return configGoals
		}
	}

	const resolveDetailed = async (
		req: PayloadRequest,
		scope?: string | null
	): Promise<ResolvedGoal[]> => {
		const key = scope ?? ''
		const at = now()
		const hit = cache.get(key)
		if (hit && hit.expiresAt > at) {
			return hit.goals
		}
		const goals = await load(req, args.scoped ? (scope ?? null) : null)
		cache.set(key, { goals, expiresAt: at + ttlMs })
		return goals
	}

	return {
		resolve: async (req, scope) => (await resolveDetailed(req, scope)).map((entry) => entry.goal),
		resolveDetailed,
		invalidate: () => cache.clear(),
	}
}
