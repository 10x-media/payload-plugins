import { keys, type TranslationKey } from '../translations/keys'
import { computeDelta } from './comparison'

const DIRECTION_COLOR: Record<'up' | 'down' | 'none', string> = {
	up: 'var(--theme-success-500, #2e8540)',
	down: 'var(--theme-error-500, #c0392b)',
	none: 'var(--theme-elevation-400)',
}

const ARROW: Record<'up' | 'down', string> = { up: '▲', down: '▼' }

const DIRECTION_LABEL: Record<'up' | 'down' | 'none', TranslationKey> = {
	up: keys.comparisonIncrease,
	down: keys.comparisonDecrease,
	none: keys.comparisonNoChange,
}

export interface ComparisonDeltaProps {
	current?: number
	previous?: number
	locale: string
	t: (key: TranslationKey) => string
}

/**
 * Period-over-period delta chip: a colored arrow, the signed percentage change, and a
 * localized "vs. previous period" caption. Renders nothing when there is no comparable
 * previous value. All text routes through typed translation keys; the arrow glyph is
 * decorative and carried by an aria-label with the localized direction word.
 */
export function ComparisonDelta({ current, previous, locale, t }: ComparisonDeltaProps) {
	const delta = computeDelta(current, previous)
	if (!delta) {
		return null
	}
	const percentText =
		delta.percent === null
			? '—'
			: new Intl.NumberFormat(locale, {
					style: 'percent',
					maximumFractionDigits: 1,
					signDisplay: 'never',
				}).format(Math.abs(delta.percent) / 100)
	const arrow = delta.direction === 'none' ? '' : ARROW[delta.direction]
	const visible =
		delta.direction === 'none' ? t(keys.comparisonNoChange) : `${arrow} ${percentText}`
	const ariaLabel = `${t(DIRECTION_LABEL[delta.direction])} ${
		delta.direction === 'none' ? '' : percentText
	} ${t(keys.comparisonVsPrevious)}`
		.replace(/\s+/g, ' ')
		.trim()
	return (
		<span
			role="img"
			aria-label={ariaLabel}
			style={{
				display: 'inline-flex',
				gap: '0.375rem',
				alignItems: 'baseline',
				fontSize: '0.75rem',
			}}
		>
			<span style={{ color: DIRECTION_COLOR[delta.direction], fontWeight: 600 }}>{visible}</span>
			<span style={{ color: 'var(--theme-elevation-400)' }}>{t(keys.comparisonVsPrevious)}</span>
		</span>
	)
}
