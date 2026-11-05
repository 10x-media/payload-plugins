import { compilePattern, matchesSegments, pathSegments } from './pathMatch'
import type { Goal } from './types'

/** The event fields goal matching reads, of the wire payload and a normalized event alike. */
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
	/**
	 * The amount before it was converted into the reporting currency, in the currency the hit was
	 * sent in (`originalCurrency`); absent when `value` is that amount already.
	 */
	sent?: number
}

/**
 * How far ingest believes a browser's amount (`revenue.browserAmounts`): `trust` over a goal's fixed
 * value, `fixed` only where a goal has none, `none` never. Server code is always believed.
 */
export type BrowserAmounts = 'none' | 'fixed' | 'trust'

export const BROWSER_AMOUNT_MODES: readonly BrowserAmounts[] = ['none', 'fixed', 'trust']

/** A goal's own worth cannot be raised or lowered from the browser, and a sale still counts. */
export const DEFAULT_BROWSER_AMOUNTS: BrowserAmounts = 'fixed'

/**
 * Whether ingest takes an unsigned browser order id (`revenue.orderSignature`): `optional` credits
 * the webhook's record only within a day of it, `required` lets no request claim an unsigned order.
 */
export type OrderSignatureMode = 'required' | 'optional'

export const ORDER_SIGNATURE_MODES: readonly OrderSignatureMode[] = ['required', 'optional']

export const DEFAULT_ORDER_SIGNATURE: OrderSignatureMode = 'optional'

/** A finite number, or a non-blank string that reads as one; anything else is undefined. */
export const finiteNumber = (value: unknown): number | undefined => {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/**
 * An amount counts only when finite and non-negative, except a server refund's own value. A goal's
 * fixed value and a value property never subtract.
 */
const amount = (value: unknown, signed = false): number | undefined => {
	const n = finiteNumber(value)
	return n !== undefined && (signed || n >= 0) ? n : undefined
}

/** Where a completion's amount comes from: the goal's fixed value, the event's own, a property. */
export type CompletionSource = 'fixed' | 'event' | 'prop' | 'none'

/** One completion before conversion: its goal, where its amount came from, and the amount. */
export interface CompletionAmount {
	goal: Goal
	source: CompletionSource
	amount: number
}

export interface MatchOptions {
	/** The event's own value may be negative: a server refund. */
	allowNegativeValue?: boolean
	/** Whether a goal's value property is read; false takes no amount the browser sent. */
	props?: boolean
	/**
	 * A goal's fixed value comes before the event's own amount, so a browser cannot raise or lower
	 * what a goal is worth: every `revenue.browserAmounts` mode but `trust`, for a browser event.
	 */
	fixedFirst?: boolean
}

const sourceOf = (
	event: MatchableEvent,
	goal: Goal,
	opts: MatchOptions
): Omit<CompletionAmount, 'goal'> => {
	const fromEvent = amount(event.value, opts.allowNegativeValue === true)
	const fixed = amount(goal.value?.fixed)
	if (opts.fixedFirst === true && fixed !== undefined) {
		return { source: 'fixed', amount: fixed }
	}
	if (fromEvent !== undefined) {
		return { source: 'event', amount: fromEvent }
	}
	if (fixed !== undefined) {
		return { source: 'fixed', amount: fixed }
	}
	const prop = opts.props === false ? undefined : goal.value?.prop
	const fromProp = prop ? amount(event.props?.[prop]) : undefined
	return fromProp === undefined
		? { source: 'none', amount: 0 }
		: { source: 'prop', amount: fromProp }
}

/** The event's path segments, split once however many path goals ask; null when too deep. */
type PathOf = () => string[] | null

const completes = (event: MatchableEvent, goal: Goal, pathOf: PathOf): boolean => {
	switch (goal.match.kind) {
		case 'goal':
			return event.type === 'goal' && event.name === goal.slug
		case 'event':
			return event.type === 'event' && event.name === goal.match.name
		case 'path': {
			if (event.type !== 'pageview') {
				return false
			}
			const pattern = compilePattern(goal.match.pattern)
			const segments = pathOf()
			return pattern !== null && segments !== null && matchesSegments(pattern, segments)
		}
	}
}

/**
 * Every goal the event completes, in config order, whatever it is worth. Path goals match with
 * `pathMatch`, whose caps keep any pattern and any path cheap.
 */
const completedGoals = (event: MatchableEvent, goals: Goal[]): Goal[] => {
	let segments: string[] | null | undefined
	const pathOf: PathOf = () => {
		if (segments === undefined) {
			segments = pathSegments(event.path)
		}
		return segments
	}
	return goals.filter((goal) => completes(event, goal, pathOf))
}

/**
 * Every goal the event completes, in config order, with each amount's source: the event's value,
 * the goal's fixed value (first under `fixedFirst`), then its value property unless `props` is false.
 */
export const completionAmounts = (
	event: MatchableEvent,
	goals: Goal[],
	opts: MatchOptions = {}
): CompletionAmount[] =>
	completedGoals(event, goals).map((goal) => ({ goal, ...sourceOf(event, goal, opts) }))
