import { GOALS_SLUG, type GoalCollectionFieldOverrides } from '../goals/collection'
import { CURRENCY_PATTERN } from '../goals/currency'
import {
	BROWSER_AMOUNT_MODES,
	DEFAULT_BROWSER_AMOUNTS,
	DEFAULT_ORDER_SIGNATURE,
	ORDER_SIGNATURE_MODES,
} from '../goals/match'
import {
	MAX_PATTERN_GLOBSTARS,
	MAX_PATTERN_SEGMENTS,
	type PatternProblem,
	patternProblem,
} from '../goals/pathMatch'
import { GOAL_SLUG_PATTERN, type Goal } from '../goals/types'
import { resolveScopedCollection } from './collectionOption'
import {
	keysOf,
	optionalBoolean,
	optionalFunction,
	optionalList,
	optionsObject,
} from './optionChecks'
import type {
	AnalyticsGoalsCollectionOptions,
	AnalyticsGoalsOptions,
	AnalyticsPluginOptions,
	AnalyticsRevenueOptions,
	ResolvedOptions,
	ResolvedRevenue,
} from './options'
import { isOneOf, isRecord, kindOf } from './values'

const GOALS_KEYS = keysOf<AnalyticsGoalsOptions>({
	defaults: true,
	collection: true,
	purchase: true,
})
const GOALS_COLLECTION_KEYS = keysOf<AnalyticsGoalsCollectionOptions>({
	slug: true,
	scopeField: true,
	fields: true,
	overrides: true,
	access: true,
})
const GOAL_FIELD_KEYS = keysOf<GoalCollectionFieldOverrides>({
	name: true,
	slug: true,
	enabled: true,
	browser: true,
	match: true,
	value: true,
	currency: true,
})
const REVENUE_KEYS = keysOf<AnalyticsRevenueOptions>({
	currency: true,
	convert: true,
	dimension: true,
	browserAmounts: true,
	orderSignature: true,
})

const PATTERN_PROBLEMS: Record<PatternProblem, string> = {
	'too-many-segments': `has more than ${MAX_PATTERN_SEGMENTS} parts in its address pattern; shorten it to ${MAX_PATTERN_SEGMENTS} or fewer`,
	'too-many-globstars': `uses ** more than ${MAX_PATTERN_GLOBSTARS} times in its address pattern; use it at most ${MAX_PATTERN_GLOBSTARS} times`,
}

/** A path goal's pattern, refused at boot when it is not a string or is over the matcher's caps. */
const assertGoalPattern = (goal: Goal): void => {
	if (goal.match.kind !== 'path') {
		return
	}
	const pattern: unknown = goal.match.pattern
	if (typeof pattern !== 'string') {
		throw new Error(
			`analytics: goal "${goal.slug}" matches a path, so match.pattern must be a string, got ${kindOf(pattern)}`
		)
	}
	const problem = patternProblem(pattern)
	if (problem !== null) {
		throw new Error(`analytics: goal "${goal.slug}" ${PATTERN_PROBLEMS[problem]}`)
	}
}

/** One config goal, refused at boot for anything ingest would otherwise drop or misread. */
const assertGoal = (goal: Goal): void => {
	if (!GOAL_SLUG_PATTERN.test(goal.slug)) {
		throw new Error(`analytics: goal slug "${goal.slug}" must be kebab-case`)
	}
	assertGoalPattern(goal)
	const fixed = goal.value?.fixed
	// Ingest would silently ignore a negative or non-finite amount, so it fails the boot instead.
	if (fixed !== undefined && (!Number.isFinite(fixed) || fixed < 0)) {
		throw new Error(
			`analytics: goal "${goal.slug}" value.fixed must be a finite number >= 0, got ${String(fixed)}`
		)
	}
	if ('wire' in goal) {
		throw new Error(
			`analytics: goal "${goal.slug}" wire is not an option, use browser: false for a goal only server code completes`
		)
	}
	optionalBoolean(goal.browser, `goal "${goal.slug}" browser`)
}

/** The config goals, as a list or `goals.defaults`, each checked and no two sharing a slug. */
const resolveConfigGoals = (option: AnalyticsPluginOptions['goals']): Goal[] => {
	if (option !== undefined && !Array.isArray(option)) {
		const shaped = optionsObject(option, {
			path: 'goals',
			known: GOALS_KEYS,
			example: 'a list of goals, or an object such as { defaults: [], collection: true }',
		})
		optionalList(
			shaped.defaults,
			'goals.defaults',
			"[{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }]"
		)
		optionalBoolean(shaped.purchase, 'goals.purchase')
	}
	const goals = Array.isArray(option) ? option : (option?.defaults ?? [])
	const listed = Array.isArray(option) ? 'goals' : 'goals.defaults'
	const seen = new Set<string>()
	for (const [index, goal] of goals.entries()) {
		const candidate: unknown = goal
		if (!isRecord(candidate) || typeof candidate.slug !== 'string' || !isRecord(candidate.match)) {
			throw new Error(
				`analytics: ${listed}[${index}] must be a goal such as { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }, got ${kindOf(candidate)}`
			)
		}
		if (seen.has(goal.slug)) {
			throw new Error(`analytics: duplicate goal slug "${goal.slug}"`)
		}
		assertGoal(goal)
		seen.add(goal.slug)
	}
	return goals
}

/** `goals`: the config goals, whether the built-in `purchase` goal is added, and the collection. */
export const resolveGoals = (
	option: AnalyticsPluginOptions['goals']
): Pick<ResolvedOptions, 'goals' | 'purchaseGoal' | 'goalsCollection'> => {
	const goals = resolveConfigGoals(option)
	const grouped = Array.isArray(option) ? undefined : option
	return {
		goals,
		purchaseGoal: grouped?.purchase !== false,
		goalsCollection: resolveScopedCollection(grouped?.collection, {
			path: 'goals.collection',
			fallback: GOALS_SLUG,
			known: GOALS_COLLECTION_KEYS,
			fieldKeys: GOAL_FIELD_KEYS,
			exampleSlug: 'goals',
		}),
	}
}

/** A revenue mode option: one of `modes`, which a refusal lists quoted and `separator`-joined. */
const assertMode = (
	value: unknown,
	at: { path: string; modes: readonly string[]; separator: string }
): void => {
	if (value !== undefined && !isOneOf(at.modes, value)) {
		const listed = at.modes.map((mode) => `'${mode}'`).join(at.separator)
		throw new Error(`analytics: ${at.path} must be ${listed}, got ${kindOf(value)}`)
	}
}

/**
 * `true` measures money with the defaults; an object turns it on and customizes it. `dimension`
 * follows, and is off whenever money is, since a currency breakdown of nothing is a column of zeros.
 */
export const resolveRevenue = (option: AnalyticsPluginOptions['revenue']): ResolvedRevenue => {
	const defaults = {
		browserAmounts: DEFAULT_BROWSER_AMOUNTS,
		orderSignature: DEFAULT_ORDER_SIGNATURE,
	}
	if (option === undefined || option === false) {
		return { enabled: false, dimension: false, ...defaults }
	}
	if (option === true) {
		return { enabled: true, dimension: true, ...defaults }
	}
	optionsObject(option, {
		path: 'revenue',
		known: REVENUE_KEYS,
		example: 'true, false or an object such as { currency: "EUR" }',
	})
	optionalBoolean(option.dimension, 'revenue.dimension')
	const { currency, browserAmounts, orderSignature } = option
	assertMode(browserAmounts, {
		path: 'revenue.browserAmounts',
		modes: BROWSER_AMOUNT_MODES,
		separator: ', ',
	})
	assertMode(orderSignature, {
		path: 'revenue.orderSignature',
		modes: ORDER_SIGNATURE_MODES,
		separator: ' or ',
	})
	if (currency !== undefined && typeof currency !== 'string' && typeof currency !== 'function') {
		throw new Error(
			`analytics: revenue.currency must be an ISO 4217 code or a function, got ${kindOf(currency)}`
		)
	}
	if (typeof currency === 'string' && !CURRENCY_PATTERN.test(currency)) {
		throw new Error(
			`analytics: revenue.currency must be a three-letter ISO 4217 code, got "${currency}"`
		)
	}
	const convert = optionalFunction(option.convert, 'revenue.convert')
	return {
		enabled: true,
		...(currency === undefined ? {} : { currency }),
		...(convert === undefined ? {} : { convert }),
		dimension: option.dimension ?? convert === undefined,
		browserAmounts: browserAmounts ?? DEFAULT_BROWSER_AMOUNTS,
		orderSignature: orderSignature ?? DEFAULT_ORDER_SIGNATURE,
	}
}

/**
 * The boot warning for an install that measures no money while a config goal carries a value,
 * or null. The value is ignored there: nothing reports revenue until `revenue` turns money on.
 */
export const revenueOffWarning = (
	resolved: Pick<ResolvedOptions, 'revenue' | 'goals'>
): string | null => {
	if (resolved.revenue.enabled) {
		return null
	}
	const valued = resolved.goals.filter((goal) => goal.value !== undefined)
	if (valued.length === 0) {
		return null
	}
	const slugs = valued.map((goal) => `"${goal.slug}"`).join(', ')
	return `analytics: revenue is off, so the value these goals carry reports nothing: ${slugs}. Set revenue to true, or to a revenue object, to measure money.`
}
