import { DAY_MS, HOUR_MS, MINUTE_MS } from '../timeframe/tz'

const NICKNAMES: ReadonlyMap<string, number> = new Map([
	['@yearly', 366 * DAY_MS],
	['@annually', 366 * DAY_MS],
	['@monthly', 31 * DAY_MS],
	['@weekly', 7 * DAY_MS],
	['@daily', DAY_MS],
	['@midnight', DAY_MS],
	['@hourly', HOUR_MS],
])

/** What one field of a pattern may hold: numbers, names, `*`, steps, lists, ranges, `?`, `L`, `W`, `#`. */
const FIELD = /^[0-9A-Za-z*/,?#-]+$/

const NUMBER = /^\d+$/

const STEP = /^\*\/(\d+)$/

const fieldsOf = (pattern: string): string[] => pattern.trim().split(/\s+/)

/**
 * Whether `value` reads as a pattern Payload's scheduler takes: five fields, six with seconds
 * first, or a nickname such as `@hourly`. A shape check only; the scheduler parses it in full.
 */
export const isCronPattern = (value: unknown): value is string => {
	if (typeof value !== 'string' || value.trim() === '') {
		return false
	}
	if (NICKNAMES.has(value.trim().toLowerCase())) {
		return true
	}
	const fields = fieldsOf(value)
	return (fields.length === 5 || fields.length === 6) && fields.every((field) => FIELD.test(field))
}

/** A step that divides its cycle evenly, so every run is the same distance from the last. */
const evenStep = (field: string | undefined, cycle: number): number | null => {
	const step = Number(STEP.exec(field ?? '')?.[1])
	return Number.isInteger(step) && step > 0 && cycle % step === 0 ? step : null
}

/**
 * How far apart a simple pattern's runs fall: every minute, every n minutes or hours, hourly,
 * daily, or a nickname. Null for any other pattern, whose cadence is not read off it.
 */
export const cronIntervalMs = (pattern: string): number | null => {
	const nickname = NICKNAMES.get(pattern.trim().toLowerCase())
	if (nickname !== undefined) {
		return nickname
	}
	const fields = fieldsOf(pattern)
	if (fields.length === 6 && !NUMBER.test(fields[0] ?? '')) {
		return null
	}
	const [minute, hour, dayOfMonth, month, dayOfWeek] =
		fields.length === 6 ? fields.slice(1) : fields
	if (fields.length < 5 || dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') {
		return null
	}
	if (hour === '*') {
		if (minute === '*') {
			return MINUTE_MS
		}
		const minutes = evenStep(minute, 60)
		if (minutes !== null) {
			return minutes * MINUTE_MS
		}
		return NUMBER.test(minute ?? '') ? HOUR_MS : null
	}
	if (!NUMBER.test(minute ?? '')) {
		return null
	}
	const hours = evenStep(hour, 24)
	if (hours !== null) {
		return hours * HOUR_MS
	}
	return NUMBER.test(hour ?? '') ? DAY_MS : null
}
