const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
	{ amount: 60, unit: 'second' },
	{ amount: 60, unit: 'minute' },
	{ amount: 24, unit: 'hour' },
	{ amount: 7, unit: 'day' },
	{ amount: 4.34524, unit: 'week' },
	{ amount: 12, unit: 'month' },
	{ amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

const toMillis = (value: Date | number | string): number =>
	value instanceof Date ? value.getTime() : new Date(value).getTime()

/**
 * Format a timestamp relative to `now`, for example `2 minutes ago` or
 * `in 1 hour`. Returns an empty string for missing or unparseable input. Pure,
 * so it can be unit-tested and reused outside the cell. `locale` defaults to
 * `en` and is passed straight through to `Intl.RelativeTimeFormat`.
 */
export const formatRelativeTime = (
	value: Date | null | number | string | undefined,
	now: number = Date.now(),
	locale = 'en'
): string => {
	if (value === null || value === undefined) {
		return ''
	}
	const time = toMillis(value)
	if (Number.isNaN(time)) {
		return ''
	}

	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
	let duration = (time - now) / 1000

	for (const division of DIVISIONS) {
		if (Math.abs(duration) < division.amount) {
			return formatter.format(Math.round(duration), division.unit)
		}
		duration /= division.amount
	}
	return formatter.format(Math.round(duration), 'year')
}
