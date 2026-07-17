import type { MetricKey } from '../core/contract'
import { keys, type TranslationKey } from '../translations/keys'
import { computeDelta, type DeltaDirection } from './comparison'

// Payload's admin palette maps success to its blue ramp and error to its red ramp; the
// fallbacks mirror @payloadcms/ui colors.scss so the chip renders identically outside
// a themed admin shell.
const SUCCESS = 'var(--theme-success-500, rgb(21, 135, 186))'
const ERROR = 'var(--theme-error-500, rgb(218, 75, 72))'
const NEUTRAL = 'var(--theme-elevation-400)'

/** Metrics where a decrease is the good outcome, inverting the delta colors. */
const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set<MetricKey>(['bounceRate'])

const colorFor = (direction: DeltaDirection, metric?: MetricKey): string => {
	if (direction === 'none') {
		return NEUTRAL
	}
	const goodWhenDown = metric !== undefined && LOWER_IS_BETTER.has(metric)
	const improved = (direction === 'up') !== goodWhenDown
	return improved ? SUCCESS : ERROR
}

const DIRECTION_LABEL: Record<DeltaDirection, TranslationKey> = {
	up: keys.comparisonIncrease,
	down: keys.comparisonDecrease,
	none: keys.comparisonNoChange,
}

const DeltaArrow = ({ direction }: { direction: 'up' | 'down' }) => (
	<svg
		aria-hidden="true"
		focusable="false"
		width="8"
		height="8"
		viewBox="0 0 8 8"
		style={{
			flexShrink: 0,
			transform: direction === 'down' ? 'rotate(180deg)' : undefined,
		}}
	>
		<path d="M4 1.2 7.3 6.8H0.7Z" fill="currentColor" />
	</svg>
)

export interface ComparisonDeltaProps {
	current?: number
	previous?: number
	/** Inverts good/bad coloring for metrics in {@link LOWER_IS_BETTER}. */
	metric?: MetricKey
	locale: string
	t: (key: TranslationKey) => string
}

/**
 * Period-over-period delta chip: a colored arrow, the percentage change, and a localized
 * "vs. previous period" caption. Renders nothing when there is no comparable previous
 * value; when the previous value is 0 (no percentage baseline) the localized direction
 * word stands in for the number. All text routes through typed translation keys; the
 * arrow is decorative and carried by an aria-label with the localized direction word.
 */
export function ComparisonDelta({ current, previous, metric, locale, t }: ComparisonDeltaProps) {
	const delta = computeDelta(current, previous)
	if (!delta) {
		return null
	}
	const percentText =
		delta.percent === null
			? null
			: new Intl.NumberFormat(locale, {
					style: 'percent',
					maximumFractionDigits: 1,
					signDisplay: 'never',
				}).format(Math.abs(delta.percent) / 100)
	// An unchanged value is a real 0%, so it reads as one; only a zero previous value
	// (no percentage exists to report) falls back to the direction word.
	const visible = percentText ?? t(DIRECTION_LABEL[delta.direction])
	const ariaLabel = `${t(DIRECTION_LABEL[delta.direction])} ${percentText ?? ''} ${t(
		keys.comparisonVsPrevious
	)}`
		.replace(/\s+/g, ' ')
		.trim()
	return (
		<span
			role="img"
			aria-label={ariaLabel}
			style={{
				display: 'inline-flex',
				gap: '0.375rem',
				// Not `baseline`: the value's own flex box takes its baseline from the arrow
				// glyph rather than its text, which lifts the value off the caption's line.
				alignItems: 'center',
				fontSize: '0.75rem',
				lineHeight: 1.25,
			}}
		>
			<span
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: '0.25rem',
					color: colorFor(delta.direction, metric),
					fontWeight: 600,
					lineHeight: 'inherit',
				}}
			>
				{delta.direction !== 'none' ? <DeltaArrow direction={delta.direction} /> : null}
				{visible}
			</span>
			<span style={{ color: 'var(--theme-elevation-400)', lineHeight: 'inherit' }}>
				{t(keys.comparisonVsPrevious)}
			</span>
		</span>
	)
}
