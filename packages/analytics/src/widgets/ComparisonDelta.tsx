import { Pill } from '@payloadcms/ui'
import type { MetricKey, MetricValue } from '../core/contract'
import { computeDelta, type DeltaDirection } from '../timeframe/comparison'
import { numberFormat } from '../translations/intl'
import { keys, type TranslationKey } from '../translations/keys'
import '../ui/analytics.css'

/** Metrics where a decrease is the good outcome, inverting the delta colors. */
const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set<MetricKey>(['bounceRate'])

/** `up` is a change for the better whichever way the number moved, `down` one for the worse. */
type DeltaTone = 'up' | 'down' | 'none'

const toneFor = (direction: DeltaDirection, metric?: MetricKey): DeltaTone => {
	if (direction === 'none') {
		return 'none'
	}
	const goodWhenDown = metric !== undefined && LOWER_IS_BETTER.has(metric)
	return (direction === 'up') !== goodWhenDown ? 'up' : 'down'
}

const PILL_STYLE = { up: 'success', down: 'error', none: 'light-gray' } as const satisfies Record<
	DeltaTone,
	string
>

const DIRECTION_LABEL: Record<DeltaDirection, TranslationKey> = {
	up: keys.comparisonIncrease,
	down: keys.comparisonDecrease,
	none: keys.comparisonNoChange,
}

const DeltaArrow = ({ direction }: { direction: 'up' | 'down' }) => (
	<svg
		aria-hidden="true"
		className={
			direction === 'down'
				? 'analytics-delta__arrow analytics-delta__arrow--down'
				: 'analytics-delta__arrow'
		}
		focusable="false"
		width="8"
		height="8"
		viewBox="0 0 8 8"
	>
		<path d="M4 1.2 7.3 6.8H0.7Z" fill="currentColor" />
	</svg>
)

export interface ComparisonDeltaProps {
	/** `null` on either side is no data, and draws no delta at all. */
	current?: MetricValue
	previous?: MetricValue
	/** Inverts good/bad coloring for metrics in {@link LOWER_IS_BETTER}. */
	metric?: MetricKey
	locale: string
	t: (key: TranslationKey, vars?: Record<string, string>) => string
	/**
	 * Shows "vs. previous period" beside the pill. A list of deltas leaves it out on each row and
	 * says it once; the pill's own name always carries it.
	 */
	caption?: boolean
}

/**
 * Period-over-period delta pill, tinted by whether the change is for the better. Renders
 * nothing without a comparable previous value; a zero previous value shows the direction word.
 */
export function ComparisonDelta({
	current,
	previous,
	metric,
	locale,
	t,
	caption = true,
}: ComparisonDeltaProps) {
	const delta = computeDelta(current, previous)
	if (!delta) {
		return null
	}
	const percentText =
		delta.percent === null
			? null
			: numberFormat(locale, {
					style: 'percent',
					maximumFractionDigits: 1,
					signDisplay: 'never',
				}).format(Math.abs(delta.percent) / 100)
	// An unchanged value is a real 0%, so it reads as one; only a zero previous value
	// (no percentage exists to report) falls back to the direction word.
	const direction = t(DIRECTION_LABEL[delta.direction])
	const visible = percentText ?? direction
	// An unchanged value says so in words; its 0% would only repeat them.
	const ariaLabel =
		percentText === null || delta.direction === 'none'
			? t(keys.comparisonDirectionLabel, { direction })
			: t(keys.comparisonChangeLabel, { direction, change: percentText })
	const tone = toneFor(delta.direction, metric)
	return (
		<span aria-label={ariaLabel} className="analytics-delta" role="img">
			<Pill
				className={`analytics-delta__change analytics-delta__change--${tone}`}
				pillStyle={PILL_STYLE[tone]}
				size="small"
			>
				{delta.direction !== 'none' ? <DeltaArrow direction={delta.direction} /> : null}
				{visible}
			</Pill>
			{caption ? (
				<span className="analytics-delta__caption">{t(keys.comparisonVsPrevious)}</span>
			) : null}
		</span>
	)
}
