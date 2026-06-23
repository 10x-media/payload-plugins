'use client'

import { type PointerEvent, useState } from 'react'
import { type BarDatum, toBarRows } from './bars'
import { ChartStyles } from './styles'

export interface BarListProps {
	data: BarDatum[]
	emptyLabel: string
}

interface Hover {
	i: number
	x: number
	y: number
}

/**
 * Ranked horizontal bar list (shadcn "custom label" style): each row is a filled,
 * proportional bar with the label inside and the value outside; hovering a row lifts
 * it and shows a tooltip with the full label and value (useful when the label is
 * truncated). Dependency-free; styling comes from the shared chart stylesheet.
 */
export function BarList({ data, emptyLabel }: BarListProps) {
	const rows = toBarRows(data)
	const [hover, setHover] = useState<Hover | null>(null)
	if (rows.length === 0) {
		return <span className="analytics-bars__empty">{emptyLabel}</span>
	}
	const track = (i: number) => (e: PointerEvent<HTMLDivElement>) =>
		setHover({ i, x: e.clientX, y: e.clientY })
	const hovered = hover ? rows[hover.i] : undefined
	return (
		<div className="analytics-chart">
			<ChartStyles />
			<div className="analytics-bars">
				{rows.map((row, i) => (
					// biome-ignore lint/a11y/noStaticElementInteractions: pointer tracking for the row tooltip, not a control
					<div
						key={row.label}
						className="analytics-bars__row"
						onPointerEnter={track(i)}
						onPointerMove={track(i)}
						onPointerLeave={() => setHover(null)}
					>
						<span className="analytics-bars__track">
							<span className="analytics-bars__fill" style={{ width: `${row.fraction * 100}%` }} />
							<span className="analytics-bars__label">{row.label}</span>
						</span>
						<span className="analytics-bars__value">{row.display ?? row.value}</span>
					</div>
				))}
			</div>
			{hover && hovered ? (
				<div
					className="analytics-chart__tooltip"
					style={{ position: 'fixed', left: hover.x, top: hover.y }}
				>
					<div className="analytics-chart__tooltip-label">{hovered.label}</div>
					<div className="analytics-chart__tooltip-value">{hovered.display ?? hovered.value}</div>
				</div>
			) : null}
		</div>
	)
}
