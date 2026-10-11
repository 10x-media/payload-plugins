import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import { currentTime } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import { isRecord } from '../core/values'
import { type CollectionProbe, createCollectionProbe, PROBE_MEMO_MS } from '../providers/probe'
import { recall, remember } from '../surfacing/bounded'
import { createEpochFallback, FIXED_CONFIG_EPOCH } from '../surfacing/epoch'
import type { GoalMatch } from '../tracker/config'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { builtinPurchaseGoal } from './builtin'
import { PURCHASE_GOAL_SLUG } from './constants'
import { GOAL_SLUG_PATTERN, type Goal } from './types'

/** The most enabled goals one scope's read takes: a ceiling, not a page size. */
const MAX_GOALS = 500

/** The most a listing over every scope takes, for the names of a report that spans them. */
const MAX_GOALS_ACROSS = 5000

/** Where a resolved goal came from, which the goals endpoint shows beside it. */
export type GoalSource = 'config' | 'collection' | 'builtin'

export interface ResolvedGoal {
	goal: Goal
	source: GoalSource
}

export interface GoalsResolver {
	resolve: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
	resolveDetailed: (req: PayloadRequest, scope?: string | null) => Promise<ResolvedGoal[]>
	/**
	 * The same merge for a reader's listing, with the collection's goals its read access shows the
	 * request's user, uncached. Ingest and jobs keep `resolveDetailed`, which sees every goal.
	 */
	listReadable: (req: PayloadRequest, scope?: string | null) => Promise<ResolvedGoal[]>
	/**
	 * The same merge over every scope the user may read, uncached, for a report spanning them; a slug
	 * two scopes share keeps the first name found.
	 */
	listAcross: (req: PayloadRequest) => Promise<ResolvedGoal[]>
	/** The scope's goals configuration epoch, which every cache key carries. */
	epoch: (scope?: string | null) => Promise<string>
	/** A save on this instance touched these scopes, which it reads again as soon as it commits. */
	changed: (scopes: Iterable<string | null>) => void
}

/**
 * A null scope matches an absent field and an empty string alike. A host-owned relationship field
 * cannot cast the empty string, so its install-wide lookups fail and resolve config goals only.
 */
export const goalScopeWhere = (scopeField: string, scope: string | null): Where =>
	scope === null
		? { or: [{ [scopeField]: { equals: null } }, { [scopeField]: { equals: '' } }] }
		: { [scopeField]: { equals: scope } }

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value : undefined

const object = (value: unknown): Record<string, unknown> | undefined =>
	isRecord(value) && !Array.isArray(value) ? value : undefined

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
 * One goal document as the matcher sees it, or null for a half-filled draft, which must match
 * neither everything nor nothing.
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
		...(doc.browser === false ? { browser: false } : {}),
	}
}

/**
 * Config order, a collection goal replacing a same-slug config goal in place, then collection extras,
 * then built-in `purchase` if unclaimed: editors adjust without reordering reports.
 */
export const mergeGoals = (config: Goal[], collection: Goal[], purchase = true): ResolvedGoal[] => {
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
	if (purchase && !out.some((entry) => entry.goal.slug === PURCHASE_GOAL_SLUG)) {
		out.push({ goal: builtinPurchaseGoal(), source: 'builtin' })
	}
	return out
}

/**
 * The built-in goal's name in the caller's admin language, applied after the cache so no scope's
 * entry freezes the language that warmed it.
 */
const translateBuiltin = (goals: ResolvedGoal[], req: PayloadRequest): ResolvedGoal[] => {
	const t = req.i18n?.t
	if (!t || !goals.some((entry) => entry.source === 'builtin')) {
		return goals
	}
	const name = asTranslate(t)(keys.goalBuiltinPurchase)
	return goals.map((entry) =>
		entry.source === 'builtin' ? { goal: { ...entry.goal, name }, source: entry.source } : entry
	)
}

/** The resolver an install without the goals collection gets: config goals, no reads. */
export const configGoalsResolver = (config: Goal[], purchase = true): GoalsResolver => {
	const detailed = mergeGoals(config, [], purchase)
	return {
		resolve: async (req) => translateBuiltin(detailed, req).map((entry) => entry.goal),
		resolveDetailed: async (req) => translateBuiltin(detailed, req),
		listReadable: async (req) => translateBuiltin(detailed, req),
		listAcross: async (req) => translateBuiltin(detailed, req),
		epoch: async () => FIXED_CONFIG_EPOCH,
		changed: () => {},
	}
}

export interface CreateGoalsResolverArgs {
	/** The instance whose goals collection this resolves. */
	payload: Payload
	slug: string
	scopeField: string
	/** True when the install configured `scope.resolve`; unscoped installs ignore scope. */
	scoped: boolean
	config: Goal[]
	/** `goals.purchase`: false drops the built-in goal for an install that never sells. */
	purchase?: boolean
	/** The collection's committed state; one over `payload.db` when left out. */
	probe?: CollectionProbe
	now?: () => number
}

interface CachedGoals {
	epoch: string
	goals: Promise<ResolvedGoal[]>
}

const goalsOf = (docs: unknown[]): Goal[] =>
	docs.filter(isRecord).flatMap((doc) => docToGoal(doc) ?? [])

/**
 * Merges collection over config goals per instance, cached per scope under its goals epoch so
 * ingest rereads only after a change. Read on its own request, outside the caller's transaction.
 */
export const createGoalsResolver = (args: CreateGoalsResolverArgs): GoalsResolver => {
	const { payload } = args
	const now = args.now ?? currentTime
	const purchase = args.purchase !== false
	const configGoals = mergeGoals(args.config, [], purchase)
	const probe =
		args.probe ??
		createCollectionProbe({
			payload,
			slug: args.slug,
			scopeField: args.scopeField,
			...(args.scoped ? { where: (scope) => goalScopeWhere(args.scopeField, scope) } : {}),
			now,
		})
	const cache = new Map<string, CachedGoals>()
	/** Scopes whose collection read failed, served the config goals until the instant kept. */
	const failed = new Map<string, number>()
	const outages = createEpochFallback(now)

	const scopeOf = (scope: string | null | undefined): string | null =>
		args.scoped && scope !== undefined && scope !== '' ? scope : null

	const whereFor = (scope: string | null): Where =>
		args.scoped
			? { and: [{ enabled: { equals: true } }, goalScopeWhere(args.scopeField, scope)] }
			: { enabled: { equals: true } }

	/** The goals collection's slug as the instance registered it; a read of a missing one throws. */
	const goalsSlug = (on: Payload): CollectionSlug => {
		if (!isCollectionSlug(on, args.slug)) {
			throw new Error(`analytics: no "${args.slug}" collection is registered for the goals`)
		}
		return args.slug
	}

	/** Every enabled goal document of the scope, as committed. */
	const findAll = async (scope: string | null): Promise<Goal[]> => {
		const { docs } = await payload.find({
			collection: goalsSlug(payload),
			where: whereFor(scope),
			limit: MAX_GOALS,
			pagination: false,
			depth: 0,
			overrideAccess: true,
		})
		return goalsOf(docs)
	}

	const resolveDetailed = async (
		req: PayloadRequest,
		raw?: string | null
	): Promise<ResolvedGoal[]> => {
		const scope = scopeOf(raw)
		const key = scope ?? ''
		const at = now()
		if ((failed.get(key) ?? 0) > at) {
			return translateBuiltin(configGoals, req)
		}
		try {
			const { epoch } = await probe.read(scope)
			let cached = recall(cache, key)
			if (cached?.epoch !== epoch) {
				const entry: CachedGoals = {
					epoch,
					goals: findAll(scope).then((goals) => mergeGoals(args.config, goals, purchase)),
				}
				remember(cache, [key, entry])
				entry.goals.catch(() => {
					if (cache.get(key) === entry) {
						cache.delete(key)
					}
				})
				cached = entry
			}
			return translateBuiltin(await cached.goals, req)
		} catch (err) {
			// Goal matching must not take ingest down with the collection: config goals still match,
			// and a broken read is asked again once per probe window rather than per event.
			remember(failed, [key, at + PROBE_MEMO_MS])
			payload.logger?.warn?.(
				`analytics: goals collection read failed for scope "${key}", falling back to config goals: ${String(err)}`
			)
			return translateBuiltin(configGoals, req)
		}
	}

	/**
	 * The documents `where` matches that the request's user may read, merged over config goals; a
	 * failed read logs `failure` and lists the config goals alone.
	 */
	const listFor = async (
		req: PayloadRequest,
		query: { where: Where; limit: number; failure: string }
	): Promise<ResolvedGoal[]> => {
		try {
			const { docs } = await req.payload.find({
				collection: goalsSlug(req.payload),
				where: query.where,
				limit: query.limit,
				pagination: false,
				depth: 0,
				overrideAccess: false,
				user: req.user,
				disableErrors: true,
				req,
			})
			return translateBuiltin(mergeGoals(args.config, goalsOf(docs), purchase), req)
		} catch (err) {
			req.payload.logger?.warn?.(`analytics: ${query.failure}: ${String(err)}`)
			return translateBuiltin(configGoals, req)
		}
	}

	const listReadable = (req: PayloadRequest, raw?: string | null): Promise<ResolvedGoal[]> => {
		const scope = scopeOf(raw)
		return listFor(req, {
			where: whereFor(scope),
			limit: MAX_GOALS,
			failure: `goals collection listing failed for scope "${scope ?? ''}", listing config goals`,
		})
	}

	const listAcross = (req: PayloadRequest): Promise<ResolvedGoal[]> =>
		args.scoped
			? listFor(req, {
					where: { enabled: { equals: true } },
					limit: MAX_GOALS_ACROSS,
					failure: 'goals collection listing across scopes failed, naming config goals only',
				})
			: listReadable(req, null)

	return {
		resolve: async (req, scope) => (await resolveDetailed(req, scope)).map((entry) => entry.goal),
		resolveDetailed,
		listReadable,
		listAcross,
		// While the collection cannot be read the scope's answers are counted with config goals alone,
		// so they key on that outage's own token: never the healthy epoch, never another outage's.
		epoch: async (raw) => {
			const scope = scopeOf(raw)
			if ((failed.get(scope ?? '') ?? 0) > now()) {
				return outages.outage(scope)
			}
			try {
				return outages.read(scope, (await probe.read(scope)).epoch)
			} catch {
				return outages.outage(scope)
			}
		},
		changed: (scopes) => probe.expedite([...scopes].map(scopeOf)),
	}
}
