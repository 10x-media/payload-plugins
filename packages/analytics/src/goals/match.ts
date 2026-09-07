import type { Goal } from './types'

/** The event fields goal matching reads. Satisfied by both the wire payload and StoredEvent. */
export interface MatchableEvent {
	type: string
	name?: string
	path: string
	props?: Record<string, unknown>
	value?: number
}

/** One goal completion: the goal's slug and the revenue this completion is worth. */
export interface GoalCompletion {
	slug: string
	value: number
}

const trimTrailingSlash = (path: string): string =>
	path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

/** Query and hash are not part of the path a pattern is matched against. */
const pathOnly = (path: string): string => {
	const cut = path.search(/[?#]/)
	return trimTrailingSlash(cut === -1 ? path : path.slice(0, cut))
}

const ESCAPE = /[.+^${}()|[\]\\]/g

/**
 * Anchored, case-sensitive glob: `*` is exactly one non-empty path segment and `**` is one
 * or more segments at any depth, so `/docs/**` covers everything below `/docs` but not
 * `/docs` itself. A trailing slash is insignificant on both sides.
 */
const patternToRegExp = (pattern: string): RegExp => {
	const body = trimTrailingSlash(pattern)
		.replace(ESCAPE, '\\$&')
		.split('**')
		.map((part) => part.replace(/\*/g, '[^/]+'))
		.join('.+')
	return new RegExp(`^${body}$`)
}

const cache = new Map<string, RegExp>()

const matchesPath = (pattern: string, path: string): boolean => {
	let re = cache.get(pattern)
	if (!re) {
		re = patternToRegExp(pattern)
		cache.set(pattern, re)
	}
	return re.test(pathOnly(path))
}

const finite = (value: unknown): number | undefined => {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

const completionValue = (event: MatchableEvent, goal: Goal): number => {
	const fromEvent = finite(event.value)
	if (fromEvent !== undefined) {
		return fromEvent
	}
	const fixed = finite(goal.value?.fixed)
	if (fixed !== undefined) {
		return fixed
	}
	const prop = goal.value?.prop
	return (prop ? finite(event.props?.[prop]) : undefined) ?? 0
}

const completes = (event: MatchableEvent, goal: Goal): boolean => {
	switch (goal.match.kind) {
		case 'goal':
			return event.type === 'goal' && event.name === goal.slug
		case 'event':
			return event.type === 'event' && event.name === goal.match.name
		case 'path':
			return event.type === 'pageview' && matchesPath(goal.match.pattern, event.path)
	}
}

/**
 * Every goal the event completes, in config order. Pure: the same event and goals always
 * produce the same completions, which is what lets a read re-derive them from a stored event.
 */
export const matchGoals = (event: MatchableEvent, goals: Goal[]): GoalCompletion[] => {
	const out: GoalCompletion[] = []
	for (const goal of goals) {
		if (completes(event, goal)) {
			out.push({ slug: goal.slug, value: completionValue(event, goal) })
		}
	}
	return out
}
