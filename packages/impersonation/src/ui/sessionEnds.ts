import { fillTemplate } from '../translations/lookup'

const formatCountdown = (expiresAt: string, now: number): string | null => {
	const remaining = new Date(expiresAt).getTime() - now
	if (!Number.isFinite(remaining) || remaining <= 0) {
		return '0s'
	}
	const totalSeconds = Math.floor(remaining / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
	}
	if (minutes > 0) {
		return `${minutes}m ${String(seconds).padStart(2, '0')}s`
	}
	return `${seconds}s`
}

/**
 * The bar's "session ends" line, or null while `now` is null. The server and the browser read
 * different clocks and time zones, so the bar renders no time until it has mounted, or it would not
 * hydrate.
 */
export const sessionEndsLabel = ({
	endsAt,
	locale,
	now,
	templates,
}: {
	endsAt?: null | string
	locale?: null | string
	now: null | number
	templates: { endsAt: string; endsIn: string }
}): null | string => {
	if (!endsAt || now === null) {
		return null
	}
	const countdown = formatCountdown(endsAt, now)
	if (countdown === '0s') {
		return null
	}
	return countdown
		? fillTemplate(templates.endsIn, '{{countdown}}', countdown)
		: fillTemplate(
				templates.endsAt,
				'{{time}}',
				new Date(endsAt).toLocaleTimeString(locale ?? undefined)
			)
}
