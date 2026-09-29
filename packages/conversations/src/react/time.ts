/** "just now", "5 min ago", "2 h ago", "3 days ago", then a date: through Intl, in the admin's language. */
export const relativeTime = (value: string, locale: string, now: number = Date.now()): string => {
	const then = new Date(value).getTime()
	const seconds = Math.round((then - now) / 1000)
	const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
	const abs = Math.abs(seconds)
	if (abs < 45) return format.format(0, 'second')
	if (abs < 45 * 60) return format.format(Math.round(seconds / 60), 'minute')
	if (abs < 22 * 3600) return format.format(Math.round(seconds / 3600), 'hour')
	if (abs < 7 * 86400) return format.format(Math.round(seconds / 86400), 'day')
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(then)
}

export const absoluteTime = (value: string, locale: string): string =>
	new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(value)
	)

/** The calendar day a message belongs to, for day separators. */
export const dayKey = (value: string): string => {
	const date = new Date(value)
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}
