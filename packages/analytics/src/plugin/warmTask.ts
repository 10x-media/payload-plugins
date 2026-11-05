import type { PayloadRequest, TaskConfig } from 'payload'
import { currentDate } from '../core/clock'
import { type ScheduledTask, TASK_SLUGS } from '../core/jobs'
import { monotonicMs } from '../core/monotonic'
import type { AdapterRegistry } from '../core/registry'
import { systemRegistryFor } from '../core/scopedRead'
import {
	type LeaseHold,
	leaseHeld,
	stateLease,
	stateStoreOf,
	TASK_LEASE_MS,
	underLease,
} from '../maintenance/lease'
import {
	concurrencyFor,
	scheduleFor,
	stuckJobGuard,
	TASK_BUDGET_MS,
	TASK_DEAD_AFTER_MS,
} from '../maintenance/taskSchedule'
import type { CacheStore, ReadRecipe } from '../surfacing/cacheStore'
import { recipeWindow } from '../surfacing/recipe'
import { HOUR_MS } from '../timeframe/tz'
import { type AnalyticsRuntime, getRuntime, resolveTimezoneFor } from './runtime'

export const WARM_TASK_SLUG = TASK_SLUGS.warm

export interface WarmTaskOptions {
	schedule: ScheduledTask
	/** `cache.warm.windowHours`: a read asked for this recently is kept warm. */
	windowHours: number
	/** `cache.warm.maxReads`: the most reads one run refreshes. */
	maxReads: number
	/** The host's `jobs.enableConcurrencyControl`, without which Payload refuses a concurrency key. */
	concurrency?: boolean
	/** How long one run works before it leaves the rest to the next; {@link TASK_BUDGET_MS}. */
	budgetMs?: number
	/** Milliseconds the budget is spent in; `monotonicMs` unless a test hands one in. */
	clock?: () => number
}

/**
 * What one run did with recent reads: `fresh` outlives the next run, `skipped` lost its source or
 * window. `ran` is false when another run held the lease, `finished` when the budget ran out.
 */
export interface WarmTaskOutput {
	ran: boolean
	finished: boolean
	refreshed: number
	fresh: number
	skipped: number
	failed: number
}

const NOTHING: Omit<WarmTaskOutput, 'ran' | 'finished'> = {
	refreshed: 0,
	fresh: 0,
	skipped: 0,
	failed: 0,
}

const notRun = (): { output: WarmTaskOutput } => ({
	output: { ran: false, finished: false, ...NOTHING },
})

/** Recent recipes read per recipe a run warms, so the scopes behind the busiest one are seen too. */
const RECIPES_READ_PER_WARM = 4

/**
 * At most `limit` recipes taken in turn from each scope, the most recently read first within a
 * scope and among the scopes, so one busy scope's reads never take every place of a run.
 */
export const takeInTurn = (recipes: readonly ReadRecipe[], limit: number): ReadRecipe[] => {
	const queues = new Map<string | null, ReadRecipe[]>()
	for (const recipe of recipes) {
		const queue = queues.get(recipe.scope)
		if (queue) {
			queue.push(recipe)
		} else {
			queues.set(recipe.scope, [recipe])
		}
	}
	const taken: ReadRecipe[] = []
	for (let round = 0; taken.length < limit; round++) {
		let any = false
		for (const queue of queues.values()) {
			const recipe = queue[round]
			if (recipe !== undefined && taken.length < limit) {
				taken.push(recipe)
				any = true
			}
		}
		if (!any) {
			break
		}
	}
	return taken
}

/** A scope's sources and timezone, resolved once per run, or why they could not be. */
type ScopeSources = { ok: true; registry: AdapterRegistry | null; tz: string } | { ok: false }

/** Each scope's sources, resolved as SYSTEM on first ask and shared by the rest of the run. */
const scopeSourcesFor = (runtime: AnalyticsRuntime, req: PayloadRequest) => {
	const resolved = new Map<string | null, Promise<ScopeSources>>()
	const resolve = async (scope: string | null): Promise<ScopeSources> => {
		try {
			const registry = await systemRegistryFor(runtime, req, scope)
			const tz = await resolveTimezoneFor(runtime, req, scope)
			return { ok: true, registry, tz }
		} catch (err) {
			req.payload.logger.warn(
				`analytics warm: the sources of scope "${scope ?? 'install-wide'}" could not be resolved: ${String(err)}`
			)
			return { ok: false }
		}
	}
	return (scope: string | null): Promise<ScopeSources> => {
		const known = resolved.get(scope)
		if (known) {
			return known
		}
		const resolving = resolve(scope)
		resolved.set(scope, resolving)
		return resolving
	}
}

interface WarmPass {
	runtime: AnalyticsRuntime
	store: CacheStore
	req: PayloadRequest
	opts: WarmTaskOptions
	hold: LeaseHold
}

/**
 * Rereads recent recipes, in turn per scope, whose today-window entry is missing or expires before
 * the next run: as SYSTEM via the scope's own sources, at background priority, within budget.
 */
const warmRecent = async ({ runtime, store, req, opts, hold }: WarmPass) => {
	const now = currentDate()
	const clock = opts.clock ?? monotonicMs
	const deadline = clock() + (opts.budgetMs ?? TASK_BUDGET_MS)
	const counts = { ...NOTHING }
	const recipes = takeInTurn(
		await store.recentRecipes(
			new Date(now.getTime() - opts.windowHours * HOUR_MS),
			opts.maxReads * RECIPES_READ_PER_WARM
		),
		opts.maxReads
	)
	const sourcesOf = scopeSourcesFor(runtime, req)
	const warned = new Set<string>()
	let finished = true
	for (const recipe of recipes) {
		if (hold.lost() || clock() >= deadline) {
			finished = false
			break
		}
		const { scope } = recipe
		const sources = await sourcesOf(scope)
		if (!sources.ok) {
			counts.failed++
			continue
		}
		const adapter = sources.registry?.all().find((each) => each.id === recipe.adapterRef)
		const dateRange = recipeWindow(recipe, now, sources.tz)
		if (!adapter || !dateRange || !runtime.engine.refresh) {
			counts.skipped++
			continue
		}
		try {
			const outcome = await runtime.engine.refresh(
				adapter,
				{ ...recipe.query, timezone: sources.tz, dateRange },
				{ freshForMs: opts.schedule.intervalMs, priority: 'background' }
			)
			counts[outcome]++
		} catch (err) {
			counts.failed++
			const source = `${scope ?? ''} ${adapter.id}`
			if (!warned.has(source)) {
				warned.add(source)
				req.payload.logger.warn(
					`analytics warm: a read from "${adapter.id}" (scope "${scope ?? ''}") failed: ${String(err)}`
				)
			}
		}
	}
	return { ...counts, finished }
}

/**
 * `analytics-warm`: keeps reads from the last `windowHours` warm, one run at a time under the task
 * lease. A missed read is still served stale and refreshed, so nothing replaces a skipped run.
 */
export const warmTask = (
	opts: WarmTaskOptions
): TaskConfig<{ input: Record<string, never>; output: WarmTaskOutput }> => ({
	slug: WARM_TASK_SLUG,
	retries: 0,
	handler: async ({ req }) => {
		const runtime = getRuntime(req.payload)
		const store = runtime?.cache?.store
		if (!runtime || !store) {
			return notRun()
		}
		const warn = (message: string) => req.payload.logger.warn(message)
		const outcome = await underLease(
			{ lease: stateLease(req.payload, WARM_TASK_SLUG, TASK_LEASE_MS), ttlMs: TASK_LEASE_MS, warn },
			(hold) => warmRecent({ runtime, store, req, opts, hold })
		)
		if (!outcome.ran) {
			return notRun()
		}
		await stateStoreOf(req.payload)
			?.beat(WARM_TASK_SLUG)
			.catch((err: unknown) =>
				warn(`analytics warm: stamping its heartbeat failed: ${String(err)}`)
			)
		return { output: { ran: true, ...outcome.value } }
	},
	...scheduleFor(
		opts.schedule,
		stuckJobGuard({
			slug: WARM_TASK_SLUG,
			deadAfterMs: TASK_DEAD_AFTER_MS,
			alive: (req) => leaseHeld(req.payload, WARM_TASK_SLUG),
		})
	),
	...concurrencyFor('warm', opts.concurrency === true),
})
