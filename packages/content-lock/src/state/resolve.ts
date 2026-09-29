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

/** Expand a window's scope, resolving `group:<key>` refs against the configured groups. */
export const scopeOf = (window: LockWindow, groups: readonly LockGroup[]): ResolvedScope => {
	if (window.scope === 'everything') {
		return { everything: true }
	}
	const collections = new Set<string>()
	const globals = new Set<string>()
	for (const target of window.targets) {
		const separator = target.indexOf(':')
		const kind = target.slice(0, separator)
		const value = target.slice(separator + 1)
		if (kind === 'collection') {
			collections.add(value)
		} else if (kind === 'global') {
			globals.add(value)
		} else if (kind === 'group') {
			const group = groups.find((candidate) => candidate.key === value)
			for (const slug of group?.collections ?? []) collections.add(slug)
			for (const slug of group?.globals ?? []) globals.add(slug)
		}
	}
	return { everything: false, collections: [...collections], globals: [...globals] }
}

const mergeScopes = (scopes: ResolvedScope[]): ResolvedScope => {
	const collections = new Set<string>()
	const globals = new Set<string>()
	for (const scope of scopes) {
		if (scope.everything) {
			return scope
		}
		for (const slug of scope.collections) collections.add(slug)
		for (const slug of scope.globals) globals.add(slug)
	}
	return { everything: false, collections: [...collections], globals: [...globals] }
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

/** Merge every window into the effective lock at `now`. Pure; the clock is an argument. */
export const resolveState = (
	windows: readonly LockWindow[],
	now: Date,
	groups: readonly LockGroup[]
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
	}
}

/** Whether a scope covers an entity. */
export const scopeCovers = (scope: ResolvedScope, entity: EntityRef): boolean => {
	if (scope.everything) {
		return true
	}
	const list = entity.type === 'collection' ? scope.collections : scope.globals
	return list.includes(entity.slug)
}

/** Whether writes to `entity` are frozen in `state`. */
export const isEntityLocked = (state: ContentLockState, entity: EntityRef): boolean =>
	state.locked && scopeCovers(state.scope, entity)

const scopeSize = (scope: ResolvedScope): number =>
	scope.everything ? Number.POSITIVE_INFINITY : scope.collections.length + scope.globals.length

/**
 * The one window the banner shows. A window touching the entity the viewer is
 * on wins; otherwise the widest blast radius: active before announced, then
 * the larger scope, then the earlier start.
 */
export const pickBanner = (
	state: ContentLockState,
	groups: readonly LockGroup[],
	route: EntityRef | null
): LockWindow | null => {
	const ranked = [
		...state.active.map((window) => ({ window, rank: 0 })),
		...state.announced.map((window) => ({ window, rank: 1 })),
	]
		.map((entry) => ({ ...entry, scope: scopeOf(entry.window, groups) }))
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				scopeSize(b.scope) - scopeSize(a.scope) ||
				Date.parse(a.window.startsAt) - Date.parse(b.window.startsAt)
		)
	if (route !== null) {
		const onRoute = ranked.find((entry) => scopeCovers(entry.scope, route))
		if (onRoute) {
			return onRoute.window
		}
	}
	return ranked[0]?.window ?? null
}
