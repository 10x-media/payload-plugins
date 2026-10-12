import type { AnalyticsFilter } from '../../../core/contract'
import { ITEM_CLICK_EVENT } from '../../../goals/constants'
import { SALE_FIELDS } from '../hits'
import { ORDER_PREFIX, SERVER_ORDER_PREFIX, WIRE_ORDER_PREFIX } from '../ids'
import { type MetricParts, PART_KEYS } from '../parts'
import {
	type HitFilter,
	isAcquisition,
	isRawDimension,
	KEPT_PARTS,
	type RawDimension,
	type RawPlan,
	readWindow,
	SESSION_DIMENSIONS,
	SESSION_GAP_MS,
	type SessionAttribute,
	type VisitorCondition,
	visitAttributesOf,
} from '../rawRead'
import type { HitWindow, RawOrder } from '../types'

/** One aggregation stage, as the driver takes it. */
export type Stage = Record<string, unknown>

/** `1` where `test` holds, else `0`: what a document adds to a count. */
export const one = (test: unknown): Record<string, unknown> => ({ $cond: [test, 1, 0] })

export const isPageview = { $eq: ['$type', 'pageview'] }

/** An event or a goal completion, as `events` counts them. */
export const isInteraction = { $in: ['$type', ['event', 'goal']] }

/** `isItemClick` of `items/ref`, as an aggregation expression. */
export const isItemClick = {
	$and: [
		{ $eq: ['$type', 'event'] },
		{ $eq: ['$name', ITEM_CLICK_EVENT] },
		{ $eq: [{ $type: '$item' }, 'string'] },
		{ $ne: ['$item', ''] },
	],
}

/** A window's scope as a `$match` takes it: one scope, a list of them, or none. */
export const scopeMatch = (window: Pick<HitWindow, 'scope' | 'scopes'>): Record<string, unknown> =>
	window.scopes !== undefined
		? { scope: { $in: [...window.scopes] } }
		: window.scope === undefined
			? {}
			: { scope: window.scope }

/** The hits of a window: an equality on `scope` first, then the `ts` range, as the index reads. */
export const windowMatch = (window: HitWindow): Record<string, unknown> => ({
	...scopeMatch(window),
	ts: { $gte: window.start, $lt: window.end },
	...(window.hostname === undefined ? {} : { hostname: window.hostname }),
})

/** Visitors of one scope and hostname a read keeps; `scope` is absent on a read of one scope. */
export interface KeptVisitors {
	scope?: string
	hostname: string
	ids: readonly string[]
}

/** A window's hits, of the kept visitors alone when a read keeps some. */
const keptMatch = (
	window: HitWindow,
	kept: readonly KeptVisitors[] | null
): Record<string, unknown> => ({
	...windowMatch(window),
	...(kept === null
		? {}
		: {
				$or: kept.map((group) => ({
					...(group.scope === undefined ? {} : { scope: group.scope }),
					hostname: group.hostname,
					v: { $in: [...group.ids] },
				})),
			}),
})

/** The ids starting with `prefix`, as a range of the primary key: `ow.` up to `ow/`. */
const keyRange = (prefix: string): Record<string, string> => ({
	$gte: prefix,
	$lt: `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`,
})

/** Whether the document's `_id` starts with `prefix` (`ow.` or `os.`, which are as long). */
const idStartsWith = (prefix: string): Record<string, unknown> => ({
	$eq: [{ $substrBytes: ['$_id', 0, prefix.length] }, prefix],
})

/** How a pipeline finds an order's other record. */
export interface TwinLookup {
	/** The hits collection's name, which `$lookup` reads the other record from. */
	from: string
	/** How far apart an order's two records may lie to count as one sale; null for any distance. */
	windowMs: number | null
}

/** `ow.` and `os.` are as long, so one offset reads the digest out of either. */
const PREFIX_BYTES = WIRE_ORDER_PREFIX.length

const DIGEST = {
	$substrBytes: ['$_id', PREFIX_BYTES, { $subtract: [{ $strLenBytes: '$_id' }, PREFIX_BYTES] }],
}

/** The id of an order record's other record, for an `ow.` or `os.` id; null for any other. */
const TWIN_ID = {
	$cond: [
		idStartsWith(WIRE_ORDER_PREFIX),
		{ $concat: [SERVER_ORDER_PREFIX, DIGEST] },
		{
			$cond: [idStartsWith(SERVER_ORDER_PREFIX), { $concat: [WIRE_ORDER_PREFIX, DIGEST] }, null],
		},
	],
}

/** What a hit reads of its order's other record: its time, its sale, and its item. */
const TWIN_FIELDS: Record<string, 1> = Object.fromEntries(
	['ts', 'item', ...SALE_FIELDS].map((field) => [field, 1])
)

/**
 * Counts each order record as `countedHit` does, its twin looked up by `_id`. Run over order
 * records alone (see {@link hitsWithTwins}): a lookup per hit would double a day's cost.
 */
export const twinStages = (twins: TwinLookup): Stage[] => {
	const found = { $eq: [{ $type: '$tw' }, 'object'] }
	const close =
		twins.windowMs === null
			? true
			: { $lte: [{ $abs: { $subtract: ['$tw.ts', '$ts'] } }, twins.windowMs] }
	const credited = { $eq: ['$cr', 1] }
	return [
		{ $set: { tid: TWIN_ID } },
		{
			$lookup: {
				from: twins.from,
				localField: 'tid',
				foreignField: '_id',
				pipeline: [{ $project: TWIN_FIELDS }],
				as: 'tw',
			},
		},
		{ $set: { tw: { $first: '$tw' } } },
		{
			$match: {
				$expr: { $not: [{ $and: [idStartsWith(SERVER_ORDER_PREFIX), found, close] }] },
			},
		},
		{
			$set: {
				cr: {
					$cond: [{ $and: [idStartsWith(WIRE_ORDER_PREFIX), found] }, one(close), null],
				},
			},
		},
		{
			$set: {
				...Object.fromEntries(
					SALE_FIELDS.map((field) => [
						field,
						{
							$cond: [
								credited,
								{ $ifNull: [`$tw.${field}`, null] },
								{ $cond: [{ $eq: ['$cr', 0] }, null, `$${field}`] },
							],
						},
					])
				),
				item: { $cond: [credited, { $ifNull: ['$tw.item', '$item'] }, '$item'] },
				server: {
					$cond: [
						{ $and: [credited, { $eq: [{ $type: '$tw.item' }, 'string'] }] },
						true,
						'$server',
					],
				},
			},
		},
		{ $unset: ['tid', 'tw', 'cr'] },
	]
}

/** Every order record's id (`o`), which no ULID starts with, as a range of the primary key. */
export const ORDER_RANGE = keyRange(ORDER_PREFIX)

/**
 * The hits `match` selects, each order counted as `countedHit` does: order records are joined in
 * by `$unionWith` with their twins looked up ({@link twinStages}), so only an order pays a lookup.
 */
export const hitsWithTwins = (match: Record<string, unknown>, twins: TwinLookup): Stage[] => [
	{ $match: { ...match, _id: { $not: ORDER_RANGE } } },
	{
		$unionWith: {
			coll: twins.from,
			pipeline: [{ $match: { ...match, _id: ORDER_RANGE } }, ...twinStages(twins)],
		},
	},
]

/**
 * A visitor match widened to every browser record of an order, whose own sale fields are not the
 * ones it is counted with: the server's record may hand it goals, a currency or an item it lacks.
 */
const orWireOrder = (match: Record<string, unknown>): Record<string, unknown> => ({
	$or: [match, { _id: keyRange(WIRE_ORDER_PREFIX) }],
})

const orNull = (field: string): Record<string, unknown> => ({ $ifNull: [`$${field}`, null] })

/** Each metric part as an aggregation expression. */
export type Parts = Record<keyof MetricParts, unknown>

/** What one hit adds to each part, as the SQL compiler's contributions. */
export const HIT_PARTS: Parts = {
	pageviews: one(isPageview),
	events: one(isInteraction),
	visitors: one({ $and: [{ $eq: ['$eng', 0] }, { $ne: ['$v', ''] }] }),
	sessions: one({ $and: [{ $eq: ['$eng', 0] }, { $ne: ['$sn', null] }] }),
	entries: '$entry',
	bounces: '$bounce',
	sessionMs: '$s_ms',
	durationMs: { $ifNull: ['$durationMs', 0] },
	scrollSum: { $ifNull: ['$scrollDepth', 0] },
	scrollSamples: one({ $and: [isPageview, { $ne: ['$scrollDepth', null] }] }),
	conversions: { $ifNull: ['$conversions', 0] },
	revenue: { $ifNull: ['$revenue', 0] },
	impressions: 0,
	interactions: one(isItemClick),
}

/** What a read projects beside every read's own fields, as the SQL hits CTE selects. */
export interface ProjectedFields {
	sessionize: boolean
	/** The visit attributes the visit chain takes from each hit (`a`). */
	attributes: readonly SessionAttribute[]
	goals: boolean
	impressions: boolean
	/**
	 * Money as it was sent: `sentCurrency`, and `sentRevenue`, each goal it completed counted with
	 * its amount as sent (its `sent`, else its `value`).
	 */
	sent: boolean
}

/** A completion's amount as sent, of `$$this` in a `$map` over the goals. */
const SENT_AMOUNT = { $ifNull: ['$$this.sent', '$$this.value'] }

/**
 * Only the fields the read needs, an absent one made null so every stage sees the same shape. The
 * sale fields are read after {@link twinStages}, as the read counts them.
 */
export const projection = (plan: ProjectedFields): Stage => {
	const fields: Record<string, unknown> = {
		_id: 1,
		scope: 1,
		ts: 1,
		hostname: 1,
		v: 1,
		type: 1,
		path: 1,
		server: { $ifNull: ['$server', false] },
		name: orNull('name'),
		item: orNull('item'),
		durationMs: orNull('durationMs'),
		scrollDepth: orNull('scrollDepth'),
		conversions: orNull('conversions'),
		revenue: orNull('revenue'),
		eng: one({ $eq: ['$type', 'engagement'] }),
	}
	if (plan.sent) {
		fields.sentCurrency = { $ifNull: ['$originalCurrency', orNull('currency')] }
		fields.sentRevenue = {
			$sum: { $map: { input: { $ifNull: ['$goals', []] }, in: SENT_AMOUNT } },
		}
	}
	if (plan.sessionize) {
		fields.act = { $ifNull: ['$lastAt', '$ts'] }
		fields.landing = { $ifNull: ['$landing', false] }
		if (plan.attributes.length > 0) {
			// An engagement carries none of them; an attribute the hit lacks is left out, not null.
			fields.a = {
				$cond: [
					{ $eq: ['$type', 'engagement'] },
					'$$REMOVE',
					Object.fromEntries(plan.attributes.map((attribute) => [attribute, `$${attribute}`])),
				],
			}
		}
	}
	if (plan.goals) {
		fields.goals = { $ifNull: ['$goals', []] }
	}
	if (plan.impressions) {
		fields.impressions = { $ifNull: ['$impressions', []] }
	}
	return { $project: fields }
}

const VISITOR = { s: '$scope', h: '$hostname', v: '$v' }
const WHOLE = { documents: ['unbounded', 'unbounded'] }
const SO_FAR = { documents: ['unbounded', 'current'] }

const visitNumberIsNull = { $eq: ['$sn', null] }

/** The visit's first hit, engagements last: `$documentNumber` takes no compound sort. */
const isEntry = { $eq: ['$_id', '$entryId'] }

const isLandingEntry = { $and: [isEntry, { $eq: ['$eng', 0] }, { $eq: ['$landing', true] }] }

/**
 * Each visit's own totals, for a day's aggregation to count the visit kinds once per visit: on its
 * representative, the first of its hits in entry order (`rep`), beside `s_pv`, `s_int` and `s_ms`.
 */
const VISIT_SUMS = {
	v_act: { $max: one({ $eq: ['$eng', 0] }), window: WHOLE },
	v_ss: { $sum: { $ifNull: ['$scrollDepth', 0] }, window: WHOLE },
	v_sc: { $sum: one({ $and: [isPageview, { $ne: ['$scrollDepth', null] }] }), window: WHOLE },
	v_conv: { $sum: { $ifNull: ['$conversions', 0] }, window: WHOLE },
	v_rev: { $sum: { $ifNull: ['$revenue', 0] }, window: WHOLE },
	v_int: { $sum: one(isItemClick), window: WHOLE },
}

export interface VisitOptions {
	/** Each hit also carries its visit's totals and whether it represents the visit. */
	sums: boolean
	/** The visit attributes taken, as `e_*`: the projection's `a` holds these alone. */
	attributes: readonly SessionAttribute[]
	/**
	 * Only the hits a day's aggregation reads them on take the attributes: a visit's
	 * representative, and a hit completing a goal.
	 */
	attributedOnly?: boolean
}

/**
 * Visits cut by the SQL frames, with each visit's entry, totals and attributes. MongoDB sorts every
 * window in full, so documents stay lean: `a` holds the attributes taken, on non-engagements alone.
 */
export const visitStages = (options: VisitOptions): Stage[] => {
	const { sums, attributes } = options
	const acquisition = attributes.filter(isAcquisition)
	const own = attributes.filter((attribute) => !isAcquisition(attribute))
	const taken = attributes.length > 0
	const hasGoals = { $gt: [{ $size: { $ifNull: ['$goals', []] } }, 0] }
	const carried = (attribute: SessionAttribute): unknown =>
		isAcquisition(attribute)
			? { $cond: [{ $eq: ['$landed', null] }, `$f.${attribute}`, `$landed.a.${attribute}`] }
			: `$f.${attribute}`
	return [
		{
			$setWindowFields: {
				partitionBy: VISITOR,
				sortBy: { ts: 1, _id: 1 },
				output: { prevAct: { $max: '$act', window: { documents: ['unbounded', -1] } } },
			},
		},
		{
			$set: {
				starts: {
					$cond: [
						{ $eq: ['$v', ''] },
						null,
						one({
							$or: [
								{ $eq: ['$prevAct', null] },
								{ $gt: ['$ts', { $add: ['$prevAct', SESSION_GAP_MS] }] },
							],
						}),
					],
				},
			},
		},
		{
			$setWindowFields: {
				partitionBy: VISITOR,
				sortBy: { ts: 1, _id: 1 },
				output: { sn: { $sum: '$starts', window: SO_FAR } },
			},
		},
		{ $set: { sn: { $cond: [{ $eq: ['$v', ''] }, null, '$sn'] } } },
		{ $unset: ['act', 'prevAct', 'starts'] },
		{
			$setWindowFields: {
				// A day's count takes a hit without a visitor as a visit of its own, totalled alone.
				partitionBy: {
					...VISITOR,
					sn: '$sn',
					...(sums ? { x: { $cond: [visitNumberIsNull, '$_id', null] } } : {}),
				},
				sortBy: { eng: 1, ts: 1, _id: 1 },
				output: {
					entryId: { $first: '$_id', window: WHOLE },
					...(taken ? { f: { $first: '$a', window: WHOLE } } : {}),
					s_pv: { $sum: one(isPageview), window: WHOLE },
					s_int: { $sum: one(isInteraction), window: WHOLE },
					s_ms: { $sum: { $ifNull: ['$durationMs', 0] }, window: WHOLE },
					...(sums ? VISIT_SUMS : {}),
				},
			},
		},
		...(taken && options.attributedOnly
			? [{ $set: { f: { $cond: [{ $or: [isEntry, hasGoals] }, '$f', '$$REMOVE'] } } }]
			: []),
		...(taken
			? [{ $set: { o: { $cond: [visitNumberIsNull, '$a', '$$REMOVE'] } } }, { $unset: 'a' }]
			: []),
		...(acquisition.length > 0
			? [
					{
						$setWindowFields: {
							partitionBy: VISITOR,
							sortBy: { sn: 1, eng: 1, ts: 1, _id: 1 },
							output: {
								// BSON compares field by field: the largest `{ n, a }` is the latest landing.
								landed: {
									$max: { $cond: [isLandingEntry, { n: '$sn', a: '$f' }, null] },
									window: SO_FAR,
								},
							},
						},
					},
				]
			: []),
		{
			$set: {
				...Object.fromEntries(
					[...acquisition, ...own].map((attribute) => [
						`e_${attribute}`,
						{
							$cond: [
								visitNumberIsNull,
								{ $ifNull: [`$o.${attribute}`, null] },
								carried(attribute),
							],
						},
					])
				),
				entry: one({ $and: [{ $ne: ['$sn', null] }, isEntry, { $eq: ['$eng', 0] }] }),
				bounce: one({
					$and: [
						{ $ne: ['$sn', null] },
						isEntry,
						{ $eq: ['$eng', 0] },
						{ $eq: ['$s_pv', 1] },
						{ $eq: ['$s_int', 0] },
					],
				}),
				...(sums ? { rep: one(isEntry) } : {}),
			},
		},
		{
			$unset: [
				...(taken ? ['f', 'o'] : []),
				...(acquisition.length > 0 ? ['landed'] : []),
				'entryId',
				'landing',
				...(sums ? [] : ['s_pv', 's_int']),
			],
		},
	]
}

/** A goal completion counts a conversion unless its hit counts none, which is a refund. */
export const completionConverts = one({ $gt: [{ $ifNull: ['$conversions', 0] }, 0] })

/** Each goal completion, or each item clicked or seen, as a document of its own. */
const factStages = (plan: RawPlan): Stage[] => {
	const own = {
		conv: { $ifNull: ['$conversions', 0] },
		rev: { $ifNull: [plan.sent ? '$sentRevenue' : '$revenue', 0] },
	}
	if (plan.axis === 'goal') {
		const completion = { $ifNull: ['$goals.value', 0] }
		return [
			{ $unwind: '$goals' },
			{
				$set: {
					x: '$goals.slug',
					conv: completionConverts,
					rev: plan.sent ? { $ifNull: ['$goals.sent', completion] } : completion,
					imp: 0,
				},
			},
		]
	}
	if (plan.axis === 'item') {
		const clicked = {
			$and: [{ $eq: ['$eng', 0] }, { $eq: [{ $type: '$item' }, 'string'] }, { $ne: ['$item', ''] }],
		}
		return [
			{
				$set: {
					facts: {
						$concatArrays: [
							{ $cond: [clicked, [{ x: '$item', imp: 0 }], []] },
							{
								$cond: [
									{ $eq: ['$eng', 1] },
									{ $map: { input: '$impressions', as: 'ref', in: { x: '$$ref', imp: 1 } } },
									[],
								],
							},
						],
					},
				},
			},
			{ $unwind: '$facts' },
			{ $set: { x: '$facts.x', imp: '$facts.imp', ...own } },
		]
	}
	return [{ $set: { x: null, imp: 0, ...own } }]
}

/** A dimension's value on a fact document. */
const dimension = (plan: RawPlan, key: RawDimension): unknown => {
	switch (key) {
		case 'page':
			return plan.axis === 'item' ? { $cond: ['$server', null, '$path'] } : '$path'
		case 'event':
			return { $cond: [{ $eq: ['$type', 'event'] }, '$name', null] }
		case 'goal':
		case 'item':
			return '$x'
		case 'currency':
			return '$sentCurrency'
		default:
			return `$e_${SESSION_DIMENSIONS[key]}`
	}
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const condition = (filter: AnalyticsFilter): unknown => {
	if (filter.operator === 'eq') {
		return filter.value
	}
	const pattern = filter.operator === 'contains' ? escapeRegex(filter.value) : filter.value
	return { $regex: pattern, $options: 'i' }
}

/** What a hit's own value must match for a visitor condition (see `VisitorCondition`). */
const hitMatch = (filter: HitFilter): Record<string, unknown> => {
	const test = condition(filter)
	switch (filter.dimension) {
		case 'page':
			return { path: test }
		case 'event':
			return { type: 'event', name: test }
		case 'currency':
			return orWireOrder({
				$or: [{ originalCurrency: test }, { originalCurrency: null, currency: test }],
			})
		case 'goal':
			return orWireOrder({ 'goals.slug': test })
		case 'item':
			return orWireOrder({ $or: [{ item: test }, { impressions: test }] })
		default:
			return { [SESSION_DIMENSIONS[filter.dimension]]: test }
	}
}

/**
 * The visitors one condition of a planned read keeps, as `{ _id: { s, h, v } }` documents: at most
 * `limit` + 1, so a condition keeping too many to be worth it is told by the count.
 */
export const keptVisitorsPipeline = (
	plan: RawPlan,
	kept: VisitorCondition,
	limit: number
): Stage[] => [
	{
		$match: {
			...windowMatch(readWindow(plan.read, kept.start)),
			...(kept.filter === undefined ? {} : hitMatch(kept.filter)),
		},
	},
	{ $group: { _id: VISITOR } },
	{ $limit: limit + 1 },
]

/** Every filter applied to the facts, after the visits were cut. */
const filterStages = (plan: RawPlan): Stage[] => {
	const { read } = plan
	const fields: Record<string, unknown> = {}
	const conditions: Array<Record<string, unknown>> = []
	if (plan.from < read.start) {
		conditions.push({ ts: { $gte: read.start } })
	}
	read.filters.forEach((filter, index) => {
		if (!isRawDimension(filter.dimension)) {
			throw new Error(`analytics: raw reads cannot filter by "${filter.dimension}"`)
		}
		fields[`d${index}`] = dimension(plan, filter.dimension)
		conditions.push({ [`d${index}`]: condition(filter) })
	})
	if (read.path !== undefined) {
		fields.dp = dimension(plan, 'page')
		conditions.push({ dp: read.path })
	}
	if (read.item !== undefined) {
		conditions.push({ x: read.item })
	}
	if (plan.group !== undefined) {
		fields.gv = dimension(plan, plan.group)
		conditions.push({ gv: { $nin: [null, ''] } })
		if (read.values !== undefined) {
			conditions.push({ gv: { $in: [...read.values] } })
		}
	}
	return [
		...(Object.keys(fields).length > 0 ? [{ $set: fields }] : []),
		...(conditions.length > 0 ? [{ $match: { $and: conditions } }] : []),
	]
}

/** The bucket of a fact's time, halving the starts as the SQL one does. */
const bucketExpression = (buckets: readonly Date[], low: number, high: number): unknown => {
	const middle = Math.ceil((low + high) / 2)
	const start = buckets[middle]
	if (low >= high || start === undefined) {
		return low
	}
	return {
		$cond: [
			{ $lt: ['$ts', start] },
			bucketExpression(buckets, low, middle - 1),
			bucketExpression(buckets, middle, high),
		],
	}
}

/**
 * What one fact adds to each counted part: a hit's own, but for the conversions, revenue and
 * impressions {@link factStages} set per fact.
 */
const contributions = (plan: RawPlan): Array<[keyof MetricParts, unknown]> => {
	const parts: Parts = {
		...HIT_PARTS,
		...(plan.axis === 'item' ? { visitors: one({ $ne: ['$v', ''] }) } : {}),
		conversions: '$conv',
		revenue: '$rev',
		impressions: '$imp',
	}
	return PART_KEYS.filter((part) => plan.counted.has(part)).map((part) => [part, parts[part]])
}

type Level = 'visit' | 'visitor' | 'row'

const fold = (part: keyof MetricParts, level: Level): unknown => {
	if (part === 'visitors' && level !== 'row') {
		return { $max: `$${part}` }
	}
	if ((part === 'sessions' || part === 'sessionMs') && level === 'visit') {
		return { $max: `$${part}` }
	}
	if (part === 'sessionMs' && level === 'visitor') {
		return { $sum: { $cond: [{ $eq: ['$sessions', 1] }, '$sessionMs', 0] } }
	}
	return { $sum: `$${part}` }
}

/**
 * The three folds of the SQL statement as `$group` stages: facts to visits, visits to visitors,
 * visitors to rows, so a distinct count never collects a set of ids in one document.
 */
const foldStages = (plan: RawPlan): Stage[] => {
	const { read } = plan
	const parts = contributions(plan)
	const keys = [
		...(plan.group === undefined ? [] : ['g']),
		...(read.buckets === undefined ? [] : ['b']),
	]
	const visits = plan.counted.has('sessions')
	const bucket = read.buckets && bucketExpression(read.buckets, 0, read.buckets.length - 1)
	const projected: Record<string, unknown> = {
		_id: 0,
		s: '$scope',
		h: '$hostname',
		v: '$v',
		...(visits ? { n: '$sn' } : {}),
		...(plan.group === undefined ? {} : { g: '$gv' }),
		// A bare number in `$project` would include or exclude the field: one bucket is index 0.
		...(bucket === undefined
			? {}
			: { b: typeof bucket === 'number' ? { $literal: bucket } : bucket }),
		...Object.fromEntries(parts),
	}
	const names = parts.map(([part]) => part)
	const accumulate = (level: Level) =>
		Object.fromEntries(names.map((part) => [part, fold(part, level)]))
	const keyOf = (fields: readonly string[], nested: boolean) =>
		Object.fromEntries(fields.map((field) => [field, nested ? `$_id.${field}` : `$${field}`]))
	const stages: Stage[] = [{ $project: projected }]
	if (visits) {
		stages.push({
			$group: { _id: keyOf([...keys, 's', 'h', 'v', 'n'], false), ...accumulate('visit') },
		})
	}
	stages.push({
		$group: { _id: keyOf([...keys, 's', 'h', 'v'], visits), ...accumulate('visitor') },
	})
	stages.push({
		$group: { _id: keys.length > 0 ? keyOf(keys, true) : null, ...accumulate('row') },
	})
	return stages
}

/**
 * Rows ranked by a read's `order` where every part it names is counted, a ratio without a
 * denominator last (`unranked`), then by `ties`, then cut to its `limit`.
 */
export const orderStages = (
	{ order, limit }: { order?: RawOrder; limit?: number },
	counted: ReadonlySet<keyof MetricParts>,
	ties: Record<string, 1>
): Stage[] => {
	const stages: Stage[] = []
	const sort: Record<string, 1 | -1> = {}
	if (order && counted.has(order.part) && (!order.per || counted.has(order.per))) {
		const part = `$${order.part}`
		const rank =
			order.per === undefined
				? part
				: {
						$cond: [
							{ $or: [{ $eq: [`$${order.per}`, 0] }, { $eq: [`$${order.per}`, null] }] },
							null,
							{ $divide: [part, `$${order.per}`] },
						],
					}
		stages.push({ $set: { rank, unranked: one({ $eq: [rank, null] }) } })
		sort.unranked = 1
		sort.rank = order.dir === 'asc' ? 1 : -1
	}
	Object.assign(sort, ties)
	if (Object.keys(sort).length > 0) {
		stages.push({ $sort: sort })
	}
	if (limit !== undefined) {
		stages.push({ $limit: limit })
	}
	return stages
}

/** Rows that counted something, ranked (nothing to rank last), then cut to the limit. */
const outputStages = (plan: RawPlan): Stage[] => {
	const { read } = plan
	const stages: Stage[] = []
	if (plan.group !== undefined || read.buckets !== undefined) {
		const kept = KEPT_PARTS.filter((part) => plan.counted.has(part)).map((part) => `$${part}`)
		stages.push({ $match: { $expr: { $gt: [{ $add: kept }, 0] } } })
	}
	const ties: Record<string, 1> = {
		...(plan.group === undefined ? {} : { '_id.g': 1 }),
		...(read.buckets === undefined ? {} : { '_id.b': 1 }),
	}
	return [...stages, ...orderStages(read, plan.counted, ties)]
}

/**
 * The pipeline answering a planned raw read, of the `kept` visitors alone when it names them. Run
 * with `allowDiskUse` and `maxTimeMS`; needs MongoDB 5.0 or later.
 */
export const rawReadPipeline = (
	plan: RawPlan,
	twins: TwinLookup,
	kept: readonly KeptVisitors[] | null = null
): Stage[] => [
	...hitsWithTwins(keptMatch(readWindow(plan.read, plan.from), kept), twins),
	projection({
		sessionize: plan.sessionize,
		attributes: visitAttributesOf(plan),
		goals: plan.axis === 'goal',
		impressions: plan.axis === 'item',
		sent: plan.sent,
	}),
	...(plan.sessionize ? visitStages({ sums: false, attributes: visitAttributesOf(plan) }) : []),
	...factStages(plan),
	...filterStages(plan),
	...foldStages(plan),
	...outputStages(plan),
]
