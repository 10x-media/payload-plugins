'use client'

import { type PointerEvent, type ReactNode, useState } from 'react'
import { type BarDatum, type BarRow, toBarRows } from './bars'
import { ChartStyles } from './styles'

export interface BarListProps {
	data: BarDatum[]
	emptyLabel: string
	/**
	 * Makes every row a button reporting its index. Left out, rows are inert: a source that
	 * cannot filter by the dimension must not offer a click that would do nothing.
	 */
	onSelect?: (index: number) => void
	/**
	 * `solid` (the default) fills the bar with the chart color and puts a white label inside
	 * it, which reads as long as every row has a bar to sit on. `soft` pales the fill and
	 * moves the label onto the elevation ramp, for a list whose rows can be zero-valued (a
	 * goal with no pageviews), where a zero-width bar leaves a white label on bare track.
	 */
	fill?: 'solid' | 'soft'
}

interface Hover {
	i: number
	x: number
	y: number
}

/**
 * Ranked rows are identified by rank, since two can share a label: a provider that answers an
 * unattributed bucket as an empty string, or one that repeats a value. Keying on the label
 * alone made those collide, and React strands the duplicates in the DOM across a rerender.
 */
const rowKey = (row: BarRow, i: number): string => `${i}:${row.label}`

const RowContent = ({ row }: { row: BarRow }): ReactNode => (
	<>
		<span className="analytics-bars__track">
			<span className="analytics-bars__fill" style={{ width: `${row.fraction * 100}%` }} />
			<span className="analytics-bars__label">{row.label}</span>
		</span>
		<span className="analytics-bars__value">{row.display ?? row.value}</span>
		{row.secondary === undefined ? null : (
			<span className="analytics-bars__secondary">{row.secondary}</span>
		)}
	</>
)

/**
 * Ranked horizontal bar list (shadcn "custom label" style): each row is a filled,
 * proportional bar with the label inside and the value outside; hovering a row lifts
 * it and shows a tooltip with the full label and value (useful when the label is
 * truncated). Dependency-free; styling comes from the shared chart stylesheet.
 */
export function BarList({ data, emptyLabel, onSelect, fill = 'solid' }: BarListProps) {
	const rows = toBarRows(data)
	const [hover, setHover] = useState<Hover | null>(null)
	if (rows.length === 0) {
		return <span className="analytics-bars__empty">{emptyLabel}</span>
	}
	const track = (i: number) => (e: PointerEvent<HTMLElement>) =>
		setHover({ i, x: e.clientX, y: e.clientY })
	const hovered = hover ? rows[hover.i] : undefined
	return (
		<div className="analytics-chart">
			<ChartStyles />
			<div className={`analytics-bars${fill === 'soft' ? ' analytics-bars--soft' : ''}`}>
				{rows.map((row, i) =>
					onSelect ? (
						<button
							className="analytics-bars__row analytics-bars__row--action"
							key={rowKey(row, i)}
							onClick={() => onSelect(i)}
							onPointerEnter={track(i)}
							onPointerLeave={() => setHover(null)}
							onPointerMove={track(i)}
							type="button"
						>
							<RowContent row={row} />
						</button>
					) : (
						<div
							className="analytics-bars__row"
							key={rowKey(row, i)}
							onPointerEnter={track(i)}
							onPointerLeave={() => setHover(null)}
							onPointerMove={track(i)}
						>
							<RowContent row={row} />
						</div>
					)
				)}
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
