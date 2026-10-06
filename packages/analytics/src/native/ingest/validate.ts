import type { EventType, RawEventInput } from './normalizeEvent'

const TYPES: ReadonlySet<string> = new Set<EventType>(['pageview', 'event', 'goal'])

const nonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length > 0

export type RawEventField = 'type' | 'path' | 'hostname' | 'name'

export interface RawEventCheck {
	/**
	 * Demand a hostname. The wire body's is optional, because ingest attributes an event to the
	 * request that carried it; server code supplies its own and there is no request to fall back
	 * on, so that path still requires one.
	 */
	requireHostname?: boolean
}

/**
 * The first required field an event fails on, or undefined when it is valid: a known `type`,
 * a `path`, and a `name` (the event name, or the goal slug on a `goal`) for everything but a
 * pageview. Optional fields are sanitized in `normalizeEvent` and dropped when malformed, so
 * one bad attribute costs an attribute rather than the whole event.
 *
 * Types are checked rather than truthiness: a non-string path would otherwise reach goal
 * matching and throw there rather than being refused here.
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
	if (raw.type !== 'pageview' && !nonEmptyString(raw.name)) {
		return 'name'
	}
	return undefined
}

export const validateRawEvent = (raw: RawEventInput | undefined): raw is RawEventInput =>
	rawEventError(raw) === undefined
