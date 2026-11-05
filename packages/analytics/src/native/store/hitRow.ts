import { isOneOf, isRecord } from '../../core/values'
import type { GoalCompletion } from '../../goals/match'
import { dateOf, jsonOf } from './columnValues'
import { HIT_MODES, type HitRow, type HitType } from './types'

const HIT_TYPES: readonly HitType[] = ['pageview', 'event', 'goal', 'engagement']

/** The optional text fields of a hit. */
const TEXT_FIELDS = [
	'name',
	'ref',
	'source',
	'channel',
	'clickId',
	'utmSource',
	'utmMedium',
	'utmCampaign',
	'utmContent',
	'utmTerm',
	'country',
	'region',
	'city',
	'language',
	'device',
	'browser',
	'os',
	'currency',
	'originalCurrency',
	'item',
] as const satisfies ReadonlyArray<keyof HitRow>

/** The optional number fields of a hit. */
const NUMBER_FIELDS = [
	'channelVersion',
	'durationMs',
	'scrollDepth',
	'value',
	'originalValue',
	'conversions',
	'revenue',
] as const satisfies ReadonlyArray<keyof HitRow>

/**
 * A number, or numeric text as node-postgres answers one; a blank string or any other value is
 * absent, where `numberOf` would read a blank as 0.
 */
const optionalNumberOf = (value: unknown): number | undefined => {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** A boolean column: `true` on Postgres and MongoDB, `1` on SQLite. */
const flagOf = (value: unknown): boolean => value === true || value === 1

const completionsOf = (value: unknown): GoalCompletion[] | undefined => {
	const parsed = jsonOf(value)
	if (!Array.isArray(parsed)) {
		return undefined
	}
	return parsed.flatMap((entry): GoalCompletion[] => {
		if (!isRecord(entry) || typeof entry.slug !== 'string') {
			return []
		}
		const value = optionalNumberOf(entry.value) ?? 0
		const sent = optionalNumberOf(entry.sent)
		return [{ slug: entry.slug, value, ...(sent === undefined ? {} : { sent }) }]
	})
}

const textsOf = (value: unknown): string[] | undefined => {
	const parsed = jsonOf(value)
	return Array.isArray(parsed)
		? parsed.filter((entry): entry is string => typeof entry === 'string')
		: undefined
}

/**
 * A stored hit read back, each field through `read` (a document's own field, or a row's column), a
 * null or missing one left out; null when what was read is no hit (no id, time or type).
 */
export const hitRowOf = (read: (field: keyof HitRow) => unknown): HitRow | null => {
	const id = read('id')
	const ts = dateOf(read('ts'))
	const type = read('type')
	if (typeof id !== 'string' || ts === null || !isOneOf(HIT_TYPES, type)) {
		return null
	}
	const text = (field: keyof HitRow): string => {
		const value = read(field)
		return typeof value === 'string' ? value : ''
	}
	const hit: HitRow = {
		id,
		scope: text('scope'),
		ts,
		type,
		hostname: text('hostname'),
		path: text('path'),
		v: text('v'),
		landing: flagOf(read('landing')),
		server: flagOf(read('server')),
	}
	const lastAt = dateOf(read('lastAt'))
	if (lastAt !== null) {
		hit.lastAt = lastAt
	}
	const mode = read('mode')
	if (isOneOf(HIT_MODES, mode)) {
		hit.mode = mode
	}
	for (const field of TEXT_FIELDS) {
		const value = read(field)
		if (typeof value === 'string') {
			hit[field] = value
		}
	}
	for (const field of NUMBER_FIELDS) {
		const value = optionalNumberOf(read(field))
		if (value !== undefined) {
			hit[field] = value
		}
	}
	const props = jsonOf(read('props'))
	if (isRecord(props)) {
		hit.props = props
	}
	const goals = completionsOf(read('goals'))
	if (goals !== undefined) {
		hit.goals = goals
	}
	const impressions = textsOf(read('impressions'))
	if (impressions !== undefined) {
		hit.impressions = impressions
	}
	return hit
}
