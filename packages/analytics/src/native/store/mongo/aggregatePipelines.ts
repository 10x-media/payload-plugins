import {
	type AggregateKind,
	type AggregatePlan,
	KIND_DIMS,
	KIND_DIMS2,
	kindsWritten,
} from '../aggregate'
import { type CardinalityCaps, UNKNOWN_WHEN_FOLDED } from '../caps'
import { type MetricParts, PART_KEYS } from '../parts'
import { KEPT_PARTS, SESSION_ATTRIBUTES } from '../rawRead'
import type { DayWindow, FoldRead, TimeWindow } from '../types'
import {
	completionConverts,
	HIT_PARTS,
	hitsWithTwins,
	isInteraction,
	isItemClick,
	one,
	orderStages,
	type Parts,
	projection,
	type Stage,
	scopeMatch,
	type TwinLookup,
	visitStages,
	windowMatch,
} from './pipelines'

/** A field holding a string other than `''`; missing and null fields hold none. */
const nonEmpty = (field: string): Record<string, unknown> => ({
	$and: [{ $eq: [{ $type: field }, 'string'] }, { $ne: [field, ''] }],
})

/** A `$group`'s `$sum` of each of `parts`, read from the field `${from}${part}`. */
const sumsOf = (parts: ReadonlyArray<keyof MetricParts>, from = '$'): Record<string, unknown> =>
	Object.fromEntries(parts.map((part) => [part, { $sum: `${from}${part}` }]))

/** What one hit adds to its currency's row: its revenue as sent. */
const SENT_PARTS: Parts = { ...HIT_PARTS, revenue: { $ifNull: ['$sentRevenue', 0] } }

/** What one goal completion (`$$this` of the goals) adds; a refund's counts no conversion. */
const GOAL_PARTS: Parts = {
	...HIT_PARTS,
	conversions: completionConverts,
	revenue: { $ifNull: ['$$this.value', 0] },
}

/** What one visit adds to a visit kind, read off its representative hit. */
const VISIT_PARTS: Parts = {
	pageviews: '$s_pv',
	events: '$s_int',
	visitors: one({ $and: [{ $eq: ['$v_act', 1] }, { $ne: ['$v', ''] }] }),
	sessions: one({ $and: [{ $eq: ['$v_act', 1] }, { $ne: ['$sn', null] }] }),
	entries: '$entry',
	bounces: '$bounce',
	sessionMs: '$s_ms',
	durationMs: '$s_ms',
	scrollSum: '$v_ss',
	scrollSamples: '$v_sc',
	conversions: '$v_conv',
	revenue: '$v_rev',
	impressions: 0,
	interactions: '$v_int',
	pageviewsWithoutVisitor: { $cond: [{ $eq: ['$v', ''] }, '$s_pv', 0] },
	pageviewsWithoutConsent: '$v_npc',
}

/** What one item clicked (`impressions` 0) or seen (1) adds; parts an item never counts are 0. */
const itemParts = (seen: 0 | 1): Parts => ({
	pageviews: 0,
	events: one(isInteraction),
	visitors: one({ $ne: ['$v', ''] }),
	sessions: 0,
	entries: 0,
	bounces: 0,
	sessionMs: 0,
	durationMs: 0,
	scrollSum: 0,
	scrollSamples: 0,
	conversions: { $ifNull: ['$conversions', 0] },
	revenue: { $ifNull: ['$revenue', 0] },
	impressions: seen,
	interactions: one(isItemClick),
	pageviewsWithoutVisitor: 0,
	pageviewsWithoutConsent: 0,
})

const fact = (kind: AggregateKind, values: [unknown, unknown], parts: Parts): object => ({
	k: kind.index,
	a: values[0],
	b: values[1],
	...parts,
})

/** `[fact]` when `test` holds, else no fact. */
const factIf = (test: unknown, made: object): object => ({ $cond: [test, [made], []] })

/** A visit kind's fact: one per visit already, so its visits are counted as they come (`once`). */
const visitFact = (kind: AggregateKind, value: unknown): object => ({
	...fact(kind, [value, ''], VISIT_PARTS),
	once: 1,
})

const visitFacts = (kinds: readonly AggregateKind[]): object => ({
	$concatArrays: kinds.map((kind) => {
		if (kind.source.from !== 'visit') {
			return [visitFact(kind, '')]
		}
		const field = `$e_${kind.source.attribute}`
		return factIf(nonEmpty(field), visitFact(kind, field))
	}),
})

/** The field each hit kind's value is read from: a currency's row is keyed by the currency sent in. */
const HIT_FIELDS = { path: '$path', name: '$name', currency: '$sentCurrency' } as const

/** Hit kinds' facts: a name's on events alone, a currency's with its revenue as sent. */
const hitFacts = (kinds: readonly AggregateKind[]): object[] =>
	kinds.flatMap((kind) => {
		if (kind.source.from !== 'hit') {
			return []
		}
		const field = HIT_FIELDS[kind.source.field]
		const test =
			kind.source.field === 'name'
				? { $and: [{ $eq: ['$type', 'event'] }, nonEmpty(field)] }
				: nonEmpty(field)
		const parts = kind.source.field === 'currency' ? SENT_PARTS : HIT_PARTS
		return [factIf(test, fact(kind, [field, ''], parts))]
	})

const goalFacts = (kinds: readonly AggregateKind[]): object => ({
	$reduce: {
		input: '$goals',
		initialValue: [],
		in: {
			$concatArrays: [
				'$$value',
				{
					$cond: [
						nonEmpty('$$this.slug'),
						{
							$concatArrays: kinds.map((kind) => {
								if (kind.source.from !== 'goal' || kind.source.attribute === null) {
									return [fact(kind, ['$$this.slug', ''], GOAL_PARTS)]
								}
								const field = `$e_${kind.source.attribute}`
								return factIf(nonEmpty(field), fact(kind, ['$$this.slug', field], GOAL_PARTS))
							}),
						},
						[],
					],
				},
			],
		},
	},
})

/** Each item kind's facts of `ref`, the item clicked or seen; server hits get no page row. */
const itemFacts = (kinds: readonly AggregateKind[], ref: string, seen: 0 | 1): object => ({
	$concatArrays: kinds.map((kind) =>
		kind.source.from === 'item' && kind.source.page
			? factIf(
					{ $and: [{ $ne: ['$server', true] }, nonEmpty('$path')] },
					fact(kind, [ref, '$path'], itemParts(seen))
				)
			: [fact(kind, [ref, ''], itemParts(seen))]
	),
})

/** Each additive part of the facts summed; a fold counts visitors and visits distinct instead. */
const FACT_SUMS = sumsOf(
	PART_KEYS.filter((part) => part !== 'visitors' && part !== 'sessions' && part !== 'sessionMs'),
	'$facts.'
)

const isOnce = { $eq: ['$facts.once', 1] }
const isSession = { $eq: ['$facts.sessions', 1] }

/**
 * Hits up to which a day always folds in sets: under 56 bytes per hit keeps a row's two sets under
 * 16 MB. A bigger day folds in sets too, and per visitor when a set outgrows its limit.
 */
export const SET_FOLD_HITS = 150_000

/**
 * Facts straight into rows, visitors and visits as sets (a visit kind's visits come one fact each):
 * the fast fold, safe up to {@link SET_FOLD_HITS} hits.
 */
const setFold: Stage[] = [
	{
		$group: {
			_id: { k: '$facts.k', a: '$facts.a', b: '$facts.b', h: '$h' },
			people: {
				$addToSet: { $cond: [{ $eq: ['$facts.visitors', 1] }, '$v', '$$REMOVE'] },
			},
			visits: {
				$addToSet: {
					$cond: [
						{ $and: [isSession, { $ne: ['$facts.once', 1] }] },
						{ v: '$v', n: '$n', ms: '$facts.sessionMs' },
						'$$REMOVE',
					],
				},
			},
			once: { $sum: { $cond: [isOnce, '$facts.sessions', 0] } },
			onceMs: { $sum: { $cond: [{ $and: [isOnce, isSession] }, '$facts.sessionMs', 0] } },
			...FACT_SUMS,
		},
	},
	{
		$set: {
			visitors: { $size: '$people' },
			sessions: { $add: ['$once', { $size: '$visits' }] },
			sessionMs: { $add: ['$onceMs', { $sum: '$visits.ms' }] },
		},
	},
	{ $unset: ['people', 'visits', 'once', 'onceMs'] },
]

/**
 * Facts per visitor, then per row: each visitor's own visits in a set, never more than one
 * visitor's day. Slower than {@link setFold}, and bounded by nothing but the disk.
 */
const visitorFold: Stage[] = [
	{
		$group: {
			_id: { k: '$facts.k', a: '$facts.a', b: '$facts.b', h: '$h', v: '$v' },
			visitors: { $max: '$facts.visitors' },
			visits: {
				$addToSet: { $cond: [isSession, { n: '$n', ms: '$facts.sessionMs' }, '$$REMOVE'] },
			},
			...FACT_SUMS,
		},
	},
	{ $set: { sessions: { $size: '$visits' }, sessionMs: { $sum: '$visits.ms' } } },
	{
		$group: {
			_id: { k: '$_id.k', a: '$_id.a', b: '$_id.b', h: '$_id.h' },
			...sumsOf(PART_KEYS),
		},
	},
]

/**
 * `capDay` in the pipeline: rows ranked within their cap's group, those past the cap folded into
 * its `(other)` row (`_id.o` 1), so a day answers at most the caps however many values it holds.
 */
const rankAndFold = (kinds: readonly AggregateKind[], caps: CardinalityCaps): Stage[] => {
	const capped = kinds.flatMap((kind): Array<[number, number]> => {
		const cap = kind.cap === null ? null : caps[kind.cap]
		return cap === null ? [] : [[kind.index, cap]]
	})
	if (capped.length === 0) {
		return []
	}
	const capOf = capped.reduceRight<unknown>(
		(otherwise, [index, cap]) => ({ $cond: [{ $eq: ['$_id.k', index] }, cap, otherwise] }),
		null
	)
	const pairs = kinds.filter((kind) => kind.dim2 !== '').map((kind) => kind.index)
	const items = kinds.filter((kind) => kind.source.from === 'item').map((kind) => kind.index)
	const group = { $cond: [{ $in: ['$_id.k', pairs] }, '$_id.a', ''] }
	return [
		{
			$set: {
				views: { $cond: [{ $in: ['$_id.k', items] }, '$impressions', '$pageviews'] },
				cap: capOf,
			},
		},
		{
			$setWindowFields: {
				partitionBy: { k: '$_id.k', h: '$_id.h', a: group },
				sortBy: { views: -1, events: -1, '_id.a': 1, '_id.b': 1 },
				// A running count, as `$documentNumber` takes one sort key alone.
				output: { rn: { $sum: 1, window: { documents: ['unbounded', 'current'] } } },
			},
		},
		{
			$set: {
				o: one({ $and: [{ $ne: ['$cap', null] }, { $gt: ['$rn', '$cap'] }] }),
			},
		},
		{
			$group: {
				_id: {
					k: '$_id.k',
					a: { $cond: ['$o', group, '$_id.a'] },
					b: { $cond: ['$o', '', '$_id.b'] },
					h: '$_id.h',
					o: '$o',
				},
				...sumsOf(PART_KEYS),
			},
		},
	]
}

/**
 * A day's count in one pipeline: the visit chain, every hit's facts, a fold, then the caps (see
 * {@link rankAndFold}); an order both sides recorded counts once (`twinStages`). Uses disk.
 */
export const dayAggregationPipeline = (
	window: TimeWindow,
	options: {
		itemPages: boolean
		fold: 'sets' | 'visitors'
		twins: TwinLookup
		caps: CardinalityCaps
	}
): Stage[] => {
	const kinds = kindsWritten(options.itemPages)
	const of = (from: string) => kinds.filter((kind) => kind.source.from === from)
	const items = of('item')
	return [
		...hitsWithTwins(windowMatch(window), options.twins),
		projection({
			sessionize: true,
			attributes: SESSION_ATTRIBUTES,
			goals: true,
			impressions: true,
			sent: true,
		}),
		...visitStages({ sums: true, attributes: SESSION_ATTRIBUTES, attributedOnly: true }),
		{
			$set: {
				facts: {
					$concatArrays: [
						{ $cond: [{ $eq: ['$rep', 1] }, visitFacts([...of('site'), ...of('visit')]), []] },
						...hitFacts(of('hit')),
						goalFacts(of('goal')),
						{
							$cond: [
								{ $and: [{ $eq: ['$eng', 0] }, nonEmpty('$item')] },
								itemFacts(items, '$item', 0),
								[],
							],
						},
						{
							$cond: [
								{ $eq: ['$eng', 1] },
								{
									$reduce: {
										input: '$impressions',
										initialValue: [],
										in: {
											$concatArrays: [
												'$$value',
												{ $cond: [nonEmpty('$$this'), itemFacts(items, '$$this', 1), []] },
											],
										},
									},
								},
								[],
							],
						},
					],
				},
			},
		},
		{ $project: { _id: 0, h: '$hostname', v: 1, n: '$sn', facts: 1 } },
		{ $unwind: '$facts' },
		...(options.fold === 'sets' ? setFold : visitorFold),
		...rankAndFold(kinds, options.caps),
	]
}

/** How many hits a day's window holds. */
export const dayHitsPipeline = (window: TimeWindow): Stage[] => [
	{ $match: windowMatch(window) },
	{ $count: 'n' },
]

/** One day's rows of every kind, as its `dim` and `dim2` values bound the aggregates index. */
export const dayRowsFilter = (
	window: Pick<DayWindow, 'scope' | 'day'>
): Record<string, unknown> => ({
	scope: window.scope,
	day: window.day,
	dim: { $in: [...KIND_DIMS] },
	dim2: { $in: [...KIND_DIMS2] },
})

/**
 * Ranges of days as one bound an index serves, with the ranges themselves where there are several.
 * Throws for no range, which every read checked before already refuses.
 */
export const daysMatch = (
	days: ReadonlyArray<readonly [number, number]>
): Record<string, unknown> => {
	const [first] = days
	if (first === undefined) {
		throw new Error('analytics: a read of days needs at least one range of them')
	}
	const from = Math.min(...days.map(([start]) => start))
	const to = Math.max(...days.map(([, end]) => end))
	return days.length === 1
		? { day: { $gte: from, $lte: to } }
		: {
				day: { $gte: from, $lte: to },
				$or: days.map(([start, end]) => ({ day: { $gte: start, $lte: end } })),
			}
}

/**
 * A fold read's rows: the value's and its `(other)` row, or a pair's `(other)` rows. A generation
 * is one run's of one day, so matching the markers' generations alone is exact.
 */
export const foldReadPipeline = (
	read: FoldRead,
	kind: AggregateKind,
	gens: readonly string[]
): Stage[] => [
	{
		$match: {
			scope: read.scope,
			dim: kind.dim,
			dim2: kind.dim2,
			...(read.hostname === undefined ? {} : { hostname: read.hostname }),
			...(kind.dim2 === ''
				? { value: { $in: [read.value, ''] } }
				: { value: read.value, value2: '' }),
			...daysMatch(read.days),
			gen: { $in: [...gens] },
		},
	},
	{ $project: { _id: 0, day: 1, hostname: 1, value: 1, value2: 1 } },
]

/**
 * Completed days' rows of the days' generations (see {@link foldReadPipeline}), summed, filtered,
 * ranked and cut in the database; a sum is null where no row counted its part.
 */
export const aggregateReadPipeline = (plan: AggregatePlan, gens: readonly string[]): Stage[] => {
	const { read, kind } = plan
	const grouped = plan.group === null ? null : `$${plan.group}`
	const valueGroup = plan.group === 'value' || plan.group === 'value2' ? plan.group : null
	const match: Record<string, unknown> = {
		...scopeMatch(read),
		dim: kind.dim,
		dim2: kind.dim2,
		...(read.hostname === undefined ? {} : { hostname: read.hostname }),
		...(read.value === undefined ? {} : { value: read.value }),
		...(read.values === undefined || valueGroup === null
			? {}
			: { [valueGroup]: { $in: [...read.values] } }),
		...daysMatch(read.days),
		gen: { $in: [...gens] },
		// An `(other)` row folds many values together: it is part of a total, never a value. Under
		// `$and`, so it joins an `$in` on the same field rather than replacing it.
		...(valueGroup === null ? {} : { $and: [{ [valueGroup]: { $ne: '' } }] }),
	}
	const counted = PART_KEYS.filter((part) => kind.counted.has(part))
	// The only counted parts a stored row holds as null, so the only sums told apart from 0.
	const unknowable = counted.filter((part) => UNKNOWN_WHEN_FOLDED.includes(part))
	const stages: Stage[] = [
		{ $match: match },
		{
			$group: {
				_id: grouped,
				...sumsOf(counted),
				...Object.fromEntries(
					unknowable.map((part) => [`${part}_n`, { $sum: one({ $isNumber: `$${part}` }) }])
				),
			},
		},
		{
			$set: Object.fromEntries([
				...unknowable.map((part) => [
					part,
					{ $cond: [{ $gt: [`$${part}_n`, 0] }, `$${part}`, null] },
				]),
				...PART_KEYS.filter((part) => !kind.counted.has(part)).map((part) => [part, null]),
			]),
		},
		...(unknowable.length > 0 ? [{ $unset: unknowable.map((part) => `${part}_n`) }] : []),
	]
	if (plan.group !== null) {
		stages.push({
			$match: {
				$expr: {
					$gt: [
						{
							$add: KEPT_PARTS.map((part) => ({
								$ifNull: [`$${part}`, 0],
							})),
						},
						0,
					],
				},
			},
		})
	}
	const ties: Record<string, 1> = plan.group === null ? {} : { _id: 1 }
	return [...stages, ...orderStages(read, kind.counted, ties)]
}
