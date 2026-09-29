import type { DateFormat } from '../lexical/dateBlock'

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000],
]

/** `in 3 hours`, `2 days ago`, in the viewer's language. */
export const formatRelative = (iso: string, now: number, language: string): string => {
	const delta = Date.parse(iso) - now
	const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
	for (const [unit, size] of UNITS) {
		if (Math.abs(delta) >= size) {
			return format.format(Math.round(delta / size), unit)
		}
	}
	return format.format(Math.round(delta / 60_000), 'minute')
}

/**
 * An instant in the viewer's language and time zone. The zone itself is left
 * out: everyone reads their own local time. `formatInstantFull` carries it.
 */
export const formatInstant = ({
	iso,
	format,
	language,
	now,
}: {
	iso: string
	format: DateFormat
	language: string
	now: number
}): string => {
	if (format === 'relative') {
		return formatRelative(iso, now, language)
	}
	const options: Intl.DateTimeFormatOptions =
		format === 'date'
			? { dateStyle: 'medium' }
			: format === 'time'
				? { timeStyle: 'short' }
				: { dateStyle: 'medium', timeStyle: 'short' }
	return new Intl.DateTimeFormat(language, options).format(new Date(iso))
}

/** The full instant with its time zone, for a hover title. */
export const formatInstantFull = (iso: string, language: string): string =>
	new Intl.DateTimeFormat(language, { dateStyle: 'full', timeStyle: 'long' }).format(new Date(iso))

/** `1:05:09`, `12:30`: the time left until an instant, never negative. */
export const formatCountdown = (msLeft: number): string => {
	const total = Math.max(0, Math.ceil(msLeft / 1000))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const seconds = total % 60
	const pad = (value: number) => String(value).padStart(2, '0')
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
