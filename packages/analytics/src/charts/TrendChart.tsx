'use client'

import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from 'react'
import type { MetricValue } from '../core/contract'
import { classNames } from '../ui/classNames'
import { ChartDataTable } from '../ui/components/ChartDataTable'
import { cssPercent, cssPx } from '../ui/cssVars'
import { arrowStep, useDirection } from '../ui/hooks/useDirection'
import { useDismissOnEscape } from '../ui/hooks/useDismissOnEscape'
import { isReading, keyAt, tooltipLabelOf, trendGeometry, VIEW } from './trendGeometry'
import '../ui/analytics.css'

/** @beta */
export interface TrendPoint {
	/** The bucket's period start as an ISO string; identity for the chart's React lists. */
	at: string
	label: string
	/** Read instead of `label` in the tooltip, where a terse axis tick needs its date back. */
	tooltipLabel?: string
	/** `null` is a bucket with no reading: the line breaks there rather than dropping to zero. */
	value: MetricValue
	display: string
	/**
	 * The bucket is still counting (today, this hour): the line into it is drawn dashed, and its
	 * `tooltipLabel` should say so.
	 */
	inProgress?: boolean
	/**
	 * The bucket has not begun yet (the rest of today, by hour): it holds its place on the axis and
	 * its tick, with no reading, no readout and no row in the data table.
	 */
	upcoming?: boolean
}

/** @beta */
export interface TrendChartProps {
	buckets: TrendPoint[]
	/** Previous-period series drawn on the same axes, aligned to `buckets` by index. */
	comparison?: TrendPoint[]
	/** Names the comparison series in the legend and the tooltip; keep it short. */
	comparisonLabel?: string
	/** The comparison window, shown in the legend only, so the tooltip stays narrow. */
	comparisonRange?: string
	/** Names the primary series in the legend; the legend only renders with a comparison. */
	label?: string
	ariaLabel: string
	/** Heads the buckets' column of the chart's data table, which only assistive tech sees. */
	periodLabel?: string
	/** The plot's height, or its floor with `fill`. */
	minHeight?: number
	/** Take the height the container gives, never less than `minHeight`, as a card's body does. */
	fill?: boolean
	/** Tells a screen reader on the plot that the arrow keys walk it. */
	keyboardHint?: string
	/** Read out in the data table for a bucket showing the dash of a missing reading. */
	noValueLabel?: string
	/** The most axis labels drawn, the first and the last among them; default 6. */
	maxTicks?: number
}

const MAX_TICKS = 6
const GRID = [0.25, 0.5, 0.75]
/** How near either end of the axis, or the top of the plot, the readout opens inward instead. */
const EDGE = 0.15
const HIGH = 0.45

/** Up and Down walk the series the same way in either reading direction. */
const VERTICAL_STEP: Partial<Record<string, 1 | -1>> = { ArrowUp: 1, ArrowDown: -1 }

const clampIndex = (i: number, last: number): number => Math.max(0, Math.min(last, i))

/** Where the readout opens around its point, so it stays on the card and off the legend. */
const tooltipClass = (x: number, y: number): string =>
	classNames(
		'analytics-chart__tooltip',
		x < EDGE && 'analytics-chart__tooltip--start',
		x > 1 - EDGE && 'analytics-chart__tooltip--end',
		y < HIGH && 'analytics-chart__tooltip--below'
	)

/** A band of the plot between `from` and `to`, taller than the plot so no stroke at an edge is cut. */
const ClipBand = ({ from, to }: { from: number; to: number }) => (
	<rect height={VIEW * 3} width={to - from} x={from} y={-VIEW} />
)

function Legend({
	label,
	comparisonLabel,
	comparisonRange,
}: Pick<TrendChartProps, 'label' | 'comparisonLabel' | 'comparisonRange'>) {
	return (
		<div className="analytics-chart__legend">
			<span className="analytics-chart__legend-item">
				<span className="analytics-chart__legend-swatch" />
				{label}
			</span>
			<span className="analytics-chart__legend-item">
				<span className="analytics-chart__legend-swatch analytics-chart__legend-swatch--comparison" />
				{comparisonLabel}
				{comparisonRange ? (
					<span className="analytics-chart__legend-range">{`· ${comparisonRange}`}</span>
				) : null}
			</span>
		</div>
	)
}

/**
 * Gradient area trend chart with an optional dashed `comparison` series, a gap for a missing reading
 * and a keyboard-reachable tooltip. Dependency-free; screen readers get a hidden data table.
 *
 * @beta
 */
export function TrendChart({
	buckets,
	comparison,
	comparisonLabel,
	comparisonRange,
	label,
	ariaLabel,
	periodLabel,
	minHeight = 160,
	fill = false,
	keyboardHint,
	noValueLabel,
	maxTicks = MAX_TICKS,
}: TrendChartProps) {
	const plot = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLDivElement>(null)
	const direction = useDirection(plot)
	const [active, setActive] = useState<number | null>(null)
	const gradientId = useId()
	const clipId = useId()
	const hintId = useId()
	useDismissOnEscape(active !== null, () => setActive(null))
	// Once per series in a fixed viewBox: no resize or hover recomputes a path, and the server draws
	// what the browser keeps. Dots, ticks and the readout sit over it in HTML, placed by share.
	const geometry = useMemo(
		() => trendGeometry(buckets, comparison, maxTicks),
		[buckets, comparison, maxTicks]
	)
	const { values, previous, reached, partial, x, y } = geometry
	const n = values.length

	const onMove = (event: PointerEvent<HTMLDivElement>): void => {
		const box = canvas.current
		if (reached < 0 || !box) {
			return
		}
		const width = box.clientWidth
		if (width <= 0) {
			return
		}
		const share = (event.clientX - box.getBoundingClientRect().left) / width
		const along = direction === 'rtl' ? 1 - share : share
		setActive(clampIndex(Math.round(along * (n - 1)), reached))
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (reached < 0) {
			return
		}
		const delta = arrowStep(event.key, direction) ?? VERTICAL_STEP[event.key]
		if (delta !== undefined) {
			event.preventDefault()
			// Nothing read yet: a forward step opens on the first bucket, a backward one on the last.
			setActive((current) =>
				clampIndex((current ?? (delta > 0 ? -1 : reached + 1)) + delta, reached)
			)
		} else if (event.key === 'Home') {
			event.preventDefault()
			setActive(0)
		} else if (event.key === 'End') {
			event.preventDefault()
			setActive(reached)
		} else if (event.key === 'Escape') {
			setActive(null)
		}
	}

	const activeValue = active !== null ? values[active] : undefined
	const activePrevious = active !== null ? previous?.[active]?.value : undefined
	const activeX = active !== null ? x(active) : 0
	// A bucket with no reading has no point to hang the readout on, so it sits mid-plot.
	const activeY = isReading(activeValue) ? y(activeValue) : 0.5

	return (
		<div
			className={classNames(
				'analytics-chart analytics-chart--trend',
				fill && 'analytics-chart--fill'
			)}
			style={{ '--analytics-chart-height': cssPx(minHeight) }}
		>
			{previous ? (
				<Legend comparisonLabel={comparisonLabel} comparisonRange={comparisonRange} label={label} />
			) : null}
			<div
				ref={plot}
				{...(keyboardHint ? { 'aria-describedby': hintId } : {})}
				aria-label={ariaLabel}
				className="analytics-chart__plot"
				onBlur={() => setActive(null)}
				onKeyDown={onKeyDown}
				onPointerLeave={() => setActive(null)}
				onPointerMove={onMove}
				role="img"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the plot is a readout the arrow keys walk, so it has to take focus
				tabIndex={0}
			>
				<div className="analytics-chart__canvas" ref={canvas}>
					<svg
						aria-hidden="true"
						className="analytics-chart__svg"
						focusable="false"
						preserveAspectRatio="none"
						viewBox={`0 0 ${VIEW} ${VIEW}`}
					>
						<defs>
							<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="var(--analytics-chart-1)" stopOpacity="0.38" />
								<stop offset="55%" stopColor="var(--analytics-chart-1)" stopOpacity="0.1" />
								<stop offset="100%" stopColor="var(--analytics-chart-1)" stopOpacity="0" />
							</linearGradient>
							{partial ? (
								<>
									<clipPath id={`${clipId}-done`}>
										<ClipBand from={0} to={partial.from} />
										<ClipBand from={partial.to} to={VIEW} />
									</clipPath>
									<clipPath id={`${clipId}-counting`}>
										<ClipBand from={partial.from} to={partial.to} />
									</clipPath>
								</>
							) : null}
						</defs>
						{GRID.map((g) => (
							<line
								key={g}
								className="analytics-chart__grid"
								x1={0}
								x2={VIEW}
								y1={g * VIEW}
								y2={g * VIEW}
							/>
						))}
						{geometry.area ? (
							<path
								className="analytics-chart__area"
								d={geometry.area}
								fill={`url(#${gradientId})`}
							/>
						) : null}
						{geometry.previousLine ? (
							<path className="analytics-chart__comparison" d={geometry.previousLine} />
						) : null}
						{geometry.line && partial ? (
							<>
								<path
									className="analytics-chart__line"
									clipPath={`url(#${clipId}-done)`}
									d={geometry.line}
								/>
								<path
									className="analytics-chart__line analytics-chart__line--partial"
									clipPath={`url(#${clipId}-counting)`}
									d={geometry.line}
								/>
							</>
						) : geometry.line ? (
							<path className="analytics-chart__line" d={geometry.line} />
						) : null}
					</svg>
					{geometry.dots.map((dot) => (
						<span
							className={classNames(
								'analytics-chart__dot',
								dot.comparison && 'analytics-chart__dot--comparison'
							)}
							key={dot.key}
							style={{ '--analytics-x': cssPercent(dot.x), '--analytics-y': cssPercent(dot.y) }}
						/>
					))}
					{active !== null ? (
						<>
							<span
								className="analytics-chart__cursor"
								style={{ '--analytics-x': cssPercent(activeX) }}
							/>
							{previous && isReading(activePrevious) ? (
								<span
									className="analytics-chart__active analytics-chart__active--comparison"
									style={{
										'--analytics-x': cssPercent(activeX),
										'--analytics-y': cssPercent(y(activePrevious)),
									}}
								/>
							) : null}
							{isReading(activeValue) ? (
								<span
									className="analytics-chart__active"
									style={{
										'--analytics-x': cssPercent(activeX),
										'--analytics-y': cssPercent(activeY),
									}}
								/>
							) : null}
							<div
								className={tooltipClass(activeX, activeY)}
								style={{
									'--analytics-x': cssPercent(activeX),
									'--analytics-y': cssPercent(activeY),
								}}
							>
								<div className="analytics-chart__tooltip-label">
									{tooltipLabelOf(buckets[active])}
								</div>
								<div className="analytics-chart__tooltip-value">{buckets[active]?.display}</div>
								{previous ? (
									<div className="analytics-chart__tooltip-comparison">
										<span>{comparisonLabel}</span>
										<span className="analytics-chart__tooltip-previous">
											{previous[active]?.display}
										</span>
									</div>
								) : null}
							</div>
						</>
					) : null}
				</div>
				<div className="analytics-chart__axis">
					{geometry.ticks.map((tick) => (
						<span
							className={`analytics-chart__tick analytics-chart__tick--${tick.anchor}`}
							key={keyAt(buckets[tick.i], tick.i)}
							style={{ '--analytics-x': cssPercent(tick.x) }}
						>
							{buckets[tick.i]?.label}
						</span>
					))}
				</div>
			</div>
			{keyboardHint ? (
				<span className="analytics-sr-only" id={hintId}>
					{keyboardHint}
				</span>
			) : null}
			<ChartDataTable
				caption={ariaLabel}
				{...(noValueLabel === undefined ? {} : { noValueLabel })}
				{...(periodLabel === undefined ? {} : { periodLabel })}
				rows={buckets.flatMap((bucket, i) =>
					bucket.upcoming === true
						? []
						: [
								{
									key: keyAt(bucket, i),
									period: tooltipLabelOf(bucket),
									value: bucket.display,
									...(previous ? { previous: previous[i]?.display ?? '' } : {}),
								},
							]
				)}
				valueLabel={label ?? ariaLabel}
				{...(previous ? { comparisonLabel: comparisonLabel ?? '' } : {})}
			/>
		</div>
	)
}
