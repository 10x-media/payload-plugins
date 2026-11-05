import { isOneOf } from '../../core/values'
import { MAX_SINCE_MS } from '../../goals/constants'
import { HIT_MODES, type HitType } from '../store/types'
import type { RawEventInput } from './normalizeEvent'

const TYPES: ReadonlySet<string> = new Set<HitType>(['pageview', 'event', 'goal', 'engagement'])

/** The types a `name` means something on; a pageview and an engagement carry none. */
const NAMED: ReadonlySet<string> = new Set<HitType>(['event', 'goal'])

const nonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length > 0

export type RawEventField = 'type' | 'path' | 'hostname' | 'name' | 'revenue' | 'value' | 'm'

interface RawEventCheck {
	/**
	 * Wire events may omit a hostname (ingest attributes them to the request); server code has no
	 * request to fall back on, so it requires one.
	 */
	requireHostname?: boolean
	/**
	 * Only `trackServerEvent` sets this. On the wire a `revenue` flag or negative amount is refused,
	 * not sanitized away, because it is a forgery attempt, not a typo.
	 */
	allowRevenue?: boolean
}

/**
 * First field an event fails on. Other optional fields are dropped later in `normalizeEvent` when
 * malformed, but server-only revenue is refused here so a forged body is not quietly recorded.
 */
export const rawEventError = (
	raw: RawEventInput | undefined,
	check: RawEventCheck = {}
): RawEventField | undefined => {
	if (!raw || !TYPES.has(raw.type)) {
		return 'type'
	}
	if (!nonEmptyString(raw.path)) {
		return 'path'
	}
	const hostname = check.requireHostname
		? nonEmptyString(raw.hostname)
		: raw.hostname === undefined || typeof raw.hostname === 'string'
	if (!hostname) {
		return 'hostname'
	}
	if (NAMED.has(raw.type) && !nonEmptyString(raw.name)) {
		return 'name'
	}
	// Refused rather than read as some mode: a mode ingest does not know may allow less than any.
	if (raw.m !== undefined && !isOneOf(HIT_MODES, raw.m)) {
		return 'm'
	}
	if (!check.allowRevenue) {
		if (raw.revenue !== undefined && raw.revenue !== false) {
			return 'revenue'
		}
		if (typeof raw.value === 'number' && raw.value < 0) {
			return 'value'
		}
	}
	return undefined
}

/**
 * An engagement's `sinceMs` as ingest believes it: whole milliseconds from 0 to a day, else
 * undefined, and the engagement is then filed when it arrives. Never a reason to refuse one.
 */
export const boundedSinceMs = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SINCE_MS
		? Math.round(value)
		: undefined

/** Whether a pageview is a single-page app's navigation: `nav: 1`, and nothing else. */
export const isNavigation = (value: unknown): boolean => value === 1
