'use client'

import { type PointerEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { monotoneAreaPath } from './spline'
import { ChartStyles } from './styles'

// useLayoutEffect measures before paint on the client; fall back to useEffect during
// SSR to avoid React's server-render warning (the chart body is gated on `measured`).
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface TrendPoint {
	label: string
	value: number
	display: string
}

export interface TrendChartProps {
	buckets: TrendPoint[]
	ariaLabel: string
	minHeight?: number
}

const MARGIN = { top: 8, right: 8, bottom: 18, left: 8 }
const MAX_TICKS = 6
const PAD = 2
const GRID = [0.25, 0.5, 0.75]

const tickIndices = (n: number): number[] => {
	if (n <= MAX_TICKS) {
		return Array.from({ length: n }, (_, i) => i)
	}
	const step = (n - 1) / (MAX_TICKS - 1)
	return Array.from({ length: MAX_TICKS }, (_, i) => Math.round(i * step))
}

/**
 * Gradient area trend chart: a monotone-cubic line over a themed gradient fill, with
 * gridlines, dots (when sparse), timeframe-aware x-axis labels, and a pointer-tracked
 * tooltip. Dependency-free; sizes to its container via a ResizeObserver so dots and
 * labels stay crisp (no aspect-ratio distortion).
 */
export function TrendChart({ buckets, ariaLabel, minHeight = 160 }: TrendChartProps) {
	const ref = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState({ w: 600, h: minHeight })
	const [measured, setMeasured] = useState(false)
	const [active, setActive] = useState<number | null>(null)
	const gradientId = useId()

	useIsomorphicLayoutEffect(() => {
		const el = ref.current
		if (!el) {
			return
		}
		const update = () => {
			const w = el.clientWidth
			const h = el.clientHeight
			if (w > 0) {
				setSize({ w, h: h || minHeight })
				setMeasured(true)
			}
		}
		update()
		const ro = new ResizeObserver(update)
		ro.observe(el)
		return () => ro.disconnect()
	}, [minHeight])

	const width = size.w
	const height = size.h
	const values = buckets.map((b) => b.value)
	const n = values.length
	const plotW = Math.max(1, width - MARGIN.left - MARGIN.right)
	const plotH = Math.max(1, height - MARGIN.top - MARGIN.bottom)
	const { line, area } = monotoneAreaPath(values, { width: plotW, height: plotH, padding: PAD })

	const vmax = n > 0 ? Math.max(...values) : 0
	const vmin = n > 0 ? Math.min(...values) : 0
	const vspan = vmax - vmin || 1
	const px = (i: number): number => (n > 1 ? (i / (n - 1)) * plotW : plotW / 2)
	const py = (v: number): number =>
		vmax === vmin ? plotH / 2 : PAD + (plotH - PAD * 2) - ((v - vmin) / vspan) * (plotH - PAD * 2)

	const onMove = (e: PointerEvent<HTMLDivElement>): void => {
		if (n === 0) {
			return
		}
		const rect = e.currentTarget.getBoundingClientRect()
		const rel = e.clientX - rect.left - MARGIN.left
		setActive(Math.max(0, Math.min(n - 1, Math.round((rel / plotW) * (n - 1)))))
	}

	const activeValue = active !== null ? (values[active] ?? 0) : 0
	return (
		<div
			ref={ref}
			className="analytics-chart"
			style={{ flex: '1 1 0', minHeight }}
			onPointerMove={onMove}
			onPointerLeave={() => setActive(null)}
		>
			<ChartStyles />
			{measured ? (
				<svg
					className="analytics-chart__svg"
					width={width}
					height={height}
					role="img"
					aria-label={ariaLabel}
				>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor="var(--analytics-chart-1)" stopOpacity="0.38" />
							<stop offset="55%" stopColor="var(--analytics-chart-1)" stopOpacity="0.1" />
							<stop offset="100%" stopColor="var(--analytics-chart-1)" stopOpacity="0" />
						</linearGradient>
					</defs>
					<g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
						{GRID.map((g) => (
							<line
								key={g}
								className="analytics-chart__grid"
								x1={0}
								x2={plotW}
								y1={g * plotH}
								y2={g * plotH}
							/>
						))}
						{area ? (
							<path className="analytics-chart__area" d={area} fill={`url(#${gradientId})`} />
						) : null}
						{line ? <path className="analytics-chart__line" d={line} /> : null}
						{n <= 12
							? values.map((v, i) => (
									<circle
										key={buckets[i]?.label ?? i}
										className="analytics-chart__dot"
										cx={px(i)}
										cy={py(v)}
										r={2.5}
									/>
								))
							: null}
						{active !== null ? (
							<>
								<line
									className="analytics-chart__cursor"
									x1={px(active)}
									x2={px(active)}
									y1={0}
									y2={plotH}
								/>
								<circle
									className="analytics-chart__active"
									cx={px(active)}
									cy={py(activeValue)}
									r={3.5}
								/>
							</>
						) : null}
					</g>
					<g transform={`translate(${MARGIN.left},${height - 4})`}>
						{tickIndices(n).map((i) => (
							<text
								key={buckets[i]?.label ?? i}
								className="analytics-chart__axis"
								x={px(i)}
								textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
							>
								{buckets[i]?.label}
							</text>
						))}
					</g>
				</svg>
			) : null}
			{active !== null ? (
				<div
					className="analytics-chart__tooltip"
					style={{ left: MARGIN.left + px(active), top: MARGIN.top + py(activeValue) }}
				>
					<div className="analytics-chart__tooltip-label">{buckets[active]?.label}</div>
					<div className="analytics-chart__tooltip-value">{buckets[active]?.display}</div>
				</div>
			) : null}
		</div>
	)
}
