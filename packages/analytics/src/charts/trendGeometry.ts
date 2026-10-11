import type { MetricValue } from '../core/contract'
import { monotoneAreaSegments, plotY, readingRuns } from './spline'
import type { TrendPoint } from './TrendChart'

/** The plot's own coordinates; the SVG stretches them over whatever box the card gives it. */
export const VIEW = 1000
const PAD = 12
/** Past this many buckets only a lone reading, with no line through it, gets a dot. */
const DOT_LIMIT = 12

export interface Tick {
	i: number
	/** The tick's position across the plot, `0` to `1`. */
	x: number
	anchor: 'start' | 'middle' | 'end'
}

export interface Dot {
	key: string
	x: number
	y: number
	comparison: boolean
}

/** Everything drawn from the data alone, so a hover redraws only the cursor and the readout. */
export interface TrendGeometry {
	values: MetricValue[]
	/** The last bucket that has begun: the readout walks no further, into the hours to come. */
	reached: number
	previous: TrendPoint[] | undefined
	line: string
	area: string
	previousLine: string
	/** The comparison's dots, then the series' own. */
	dots: Dot[]
	ticks: Tick[]
	/**
	 * The stretch of the plot, in its own units, between the last finished bucket and the one still
	 * counting; null when every bucket drawn is finished.
	 */
	partial: { from: number; to: number } | null
	/** A bucket's position across the plot, `0` to `1`, in reading order. */
	x: (i: number) => number
	/** A reading's position down the plot, `0` to `1`. */
	y: (value: number) => number
}

/** Up to `most` evenly spaced indices of `n` buckets, the first and the last among them. */
const tickIndices = (n: number, most: number): number[] => {
	if (n <= most) {
		return Array.from({ length: n }, (_, i) => i)
	}
	if (most < 2) {
		return [n - 1]
	}
	const step = (n - 1) / (most - 1)
	return Array.from({ length: most }, (_, i) => Math.round(i * step))
}

const EMPTY_POINT: TrendPoint = { at: '', label: '', value: 0, display: '0' }

/** Both windows have equal bucket counts by construction; a stray length normalizes silently. */
const alignTo = (series: TrendPoint[], length: number): TrendPoint[] =>
	series.length === length
		? series
		: Array.from({ length }, (_, i) => series[i] ?? { ...EMPTY_POINT })

/** Two buckets can carry the same label ("Mon" twice over a fortnight); their starts cannot. */
export const keyAt = (point: TrendPoint | undefined, i: number): string => point?.at || String(i)

/** How the tooltip and the data table name a bucket: its tooltip label, else its axis tick. */
export const tooltipLabelOf = (point: TrendPoint | undefined): string =>
	point?.tooltipLabel ?? point?.label ?? ''

export const isReading = (value: MetricValue | undefined): value is number =>
	typeof value === 'number'

/** Indices of readings with no neighbour to draw a line to, which only a dot can show. */
const loneIndices = (values: MetricValue[]): Set<number> =>
	new Set(
		readingRuns(values)
			.filter((run) => run.start === run.end)
			.map((run) => run.start)
	)

/**
 * The chart's paths, dots and ticks, laid out once per series in the fixed {@link VIEW} box, both
 * series on one y-scale. An upcoming bucket keeps its place on the axis with no reading.
 */
export const trendGeometry = (
	buckets: TrendPoint[],
	comparison: TrendPoint[] | undefined,
	maxTicks: number
): TrendGeometry => {
	const upcoming = (i: number): boolean => buckets[i]?.upcoming === true
	const values = buckets.map((bucket, i) => (upcoming(i) ? null : bucket.value))
	const n = values.length
	const previous = comparison ? alignTo(comparison, n) : undefined
	const previousValues = previous?.map((point, i) => (upcoming(i) ? null : point.value))
	const readings = [...values, ...(previousValues ?? [])].filter(isReading)
	const domain =
		readings.length > 0
			? { min: Math.min(...readings), max: Math.max(...readings) }
			: { min: 0, max: 0 }
	const box = { width: VIEW, height: VIEW, padding: PAD, domain }
	const { line, area } = monotoneAreaSegments(values, box)
	const x = (i: number): number => (n > 1 ? i / (n - 1) : 0.5)
	const yInBox = plotY(readings, box)
	const y = (value: number): number => yInBox(value) / VIEW
	const dotsOf = (series: MetricValue[], isPrevious: boolean): Dot[] => {
		const lone = loneIndices(series)
		return series.flatMap((value, i) =>
			isReading(value) && (n <= DOT_LIMIT || lone.has(i))
				? [
						{
							key: `${isPrevious ? 'previous-' : ''}${keyAt(buckets[i], i)}`,
							x: x(i),
							y: y(value),
							comparison: isPrevious,
						},
					]
				: []
		)
	}
	const counting = buckets.findIndex((bucket) => bucket.inProgress === true)
	return {
		values,
		reached: buckets.findLastIndex((_, i) => !upcoming(i)),
		previous,
		line,
		area,
		previousLine: previousValues ? monotoneAreaSegments(previousValues, box).line : '',
		dots: [...(previousValues ? dotsOf(previousValues, true) : []), ...dotsOf(values, false)],
		ticks: tickIndices(n, maxTicks).map((i) => ({
			i,
			x: x(i),
			anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
		})),
		partial: counting > 0 ? { from: x(counting - 1) * VIEW, to: x(counting) * VIEW } : null,
		x,
		y,
	}
}
