import type {
	ContentLockState,
	EntityRef,
	LockGroup,
	LockWindow,
	ResolvedScope,
	WindowStatus,
} from './types'

const time = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso))

/**
 * A window's status at `now`. Ending wins over everything, so a window that
 * was ended before it started never shows as active.
 */
export const statusOf = (window: LockWindow, now: Date): WindowStatus => {
	const at = now.getTime()
	const endedAt = time(window.endedAt)
	const endsAt = window.endMode === 'at' ? time(window.endsAt) : null
	if ((endedAt !== null && endedAt <= at) || (endsAt !== null && endsAt <= at)) {
		return 'ended'
	}
	if (Date.parse(window.startsAt) <= at) {
		return 'active'
	}
	const announceAt = time(window.announceAt)
	if (announceAt !== null && announceAt <= at) {
		return 'announced'
	}
	return 'pending'
}

/**
 * The targets worth naming to a reader: every group, plus the collections and
 * globals no selected group already covers. Picking "Catalog" and also
 * "Products" reads as just "Catalog".
 */
export const namedTargets = (
	targets: readonly string[],
	groups: readonly (Pick<LockGroup, 'key' | 'collections' | 'globals'> & { custom?: string[] })[]
): string[] => {
	const selected = groups.filter((group) => targets.includes(`group:${group.key}`))
	const covered = new Set([
		...selected.flatMap((group) => group.collections.map((slug) => `collection:${slug}`)),
		...selected.flatMap((group) => group.globals.map((slug) => `global:${slug}`)),
		...selected.flatMap((group) => (group.custom ?? []).map((key) => `custom:${key}`)),
	])
	return targets.filter((target) => !covered.has(target))
}

/** Expand a window's scope, resolving `group:<key>` refs against the configured groups. */
export const scopeOf = (window: LockWindow, groups: readonly LockGroup[]): ResolvedScope => {
	if (window.scope === 'everything') {
		return { everything: true }
	}
	const collections = new Set<string>()
	const globals = new Set<string>()
	const custom = new Set<string>()
	for (const target of window.targets) {
		const separator = target.indexOf(':')
		const kind = target.slice(0, separator)
		const value = target.slice(separator + 1)
		if (kind === 'collection') {
			collections.add(value)
		} else if (kind === 'global') {
			globals.add(value)
		} else if (kind === 'custom') {
			custom.add(value)
		} else if (kind === 'group') {
			const group = groups.find((candidate) => candidate.key === value)
			for (const slug of group?.collections ?? []) collections.add(slug)
			for (const slug of group?.globals ?? []) globals.add(slug)
			for (const key of group?.custom ?? []) custom.add(key)
		}
	}
	return {
		everything: false,
		collections: [...collections],
		globals: [...globals],
		custom: [...custom],
	}
}

const mergeScopes = (scopes: ResolvedScope[]): ResolvedScope => {
	const collections = new Set<string>()
	const globals = new Set<string>()
	const custom = new Set<string>()
	for (const scope of scopes) {
		if (scope.everything) {
			return scope
		}
		for (const slug of scope.collections) collections.add(slug)
		for (const slug of scope.globals) globals.add(slug)
		for (const key of scope.custom) custom.add(key)
	}
	return {
		everything: false,
		collections: [...collections],
		globals: [...globals],
		custom: [...custom],
	}
}

const latestEnd = (active: LockWindow[]): string | null => {
	let latest: string | null = null
	for (const window of active) {
		if (window.endMode === 'manual' || window.endsAt === null) {
			return null
		}
		if (latest === null || Date.parse(window.endsAt) > Date.parse(latest)) {
			latest = window.endsAt
		}
	}
	return latest
}

/**
 * Merge every window into the effective lock at `now`, with the configured
 * groups and exemptions. Pure; the clock is an argument.
 */
export const resolveState = (
	windows: readonly LockWindow[],
	now: Date,
	{ groups, exempt = [] }: { groups: readonly LockGroup[]; exempt?: readonly string[] }
): ContentLockState => {
	const active = windows.filter((window) => statusOf(window, now) === 'active')
	const announced = windows.filter((window) => statusOf(window, now) === 'announced')
	return {
		locked: active.length > 0,
		scope: mergeScopes(active.map((window) => scopeOf(window, groups))),
		endsAt: latestEnd(active),
		active,
		announced,
		resolvedAt: now.toISOString(),
		exempt: [...exempt],
	}
}

/** Whether a scope covers an entity. */
export const scopeCovers = (scope: ResolvedScope, entity: EntityRef): boolean => {
	if (scope.everything) {
		return true
	}
	const list =
		entity.type === 'collection'
			? scope.collections
			: entity.type === 'global'
				? scope.globals
				: scope.custom
	return list.includes(entity.slug)
}

/** Whether `entity` is locked in `state`. Exempt collections and globals never are. */
export const isEntityLocked = (state: ContentLockState, entity: EntityRef): boolean =>
	state.locked &&
	!(entity.type !== 'custom' && (state.exempt ?? []).includes(entity.slug)) &&
	scopeCovers(state.scope, entity)

const scopeSize = (scope: ResolvedScope): number =>
	scope.everything
		? Number.POSITIVE_INFINITY
		: scope.collections.length + scope.globals.length + scope.custom.length

/**
 * The windows the banner pages through, in order. On a page that stands for
 * something a lock can cover (a collection, a global, a custom target's view)
 * only windows covering it count; elsewhere (dashboard, account, other views)
 * all do. Active windows come first, ranked by blast radius
 * (larger scope, then earlier start); announced ones follow, ranked by what
 * happens first (earlier start, then larger scope).
 */
export const orderBanners = (
	state: ContentLockState,
	groups: readonly LockGroup[],
	route: EntityRef | readonly EntityRef[] | null
): LockWindow[] => {
	const refs = route === null ? [] : Array.isArray(route) ? route : [route as EntityRef]
	const ranked = [
		...state.active.map((window) => ({ window, active: true })),
		...state.announced.map((window) => ({ window, active: false })),
	]
		.map((entry) => {
			const scope = scopeOf(entry.window, groups)
			return {
				...entry,
				relevant: refs.length === 0 || refs.some((ref) => scopeCovers(scope, ref)),
				size: scopeSize(scope),
				start: Date.parse(entry.window.startsAt),
			}
		})
		.filter((entry) => entry.relevant)
	ranked.sort((a, b) => {
		const byStage = Number(b.active) - Number(a.active)
		if (byStage !== 0) {
			return byStage
		}
		const bySize = b.size === a.size ? 0 : b.size > a.size ? 1 : -1
		return a.active ? bySize || a.start - b.start : a.start - b.start || bySize
	})
	return ranked.map((entry) => entry.window)
}
