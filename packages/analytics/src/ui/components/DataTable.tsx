'use client'

import {
	type FocusEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react'
import { classNames } from '../classNames'
import { cssPercent, cssPx } from '../cssVars'
import { useDismissOnEscape } from '../hooks/useDismissOnEscape'
import { shownValue } from './NoValue'
import '../analytics.css'

/** @beta */
export type SortDirection = 'ascending' | 'descending'

/** @beta */
export interface DataTableColumn {
	key: string
	header: string
	/** This column orders the rows, which its header says with `aria-sort`. */
	sorted?: SortDirection
	/** Makes the header a button that sorts by this column. */
	onSort?: () => void
	/** On this column's cells. */
	className?: string
	/** On this column's header. */
	headerClassName?: string
}

/** @beta */
export interface DataTableRow {
	/** Unique within the table; a rank where two rows share a label. */
	key: string
	/** The row header: what the row is about. */
	label: string
	/** Drawn before the label and hidden from assistive tech, as a country's flag is. */
	decoration?: ReactNode
	/** The row's share of the largest value, `0` to `1`, drawn as the label cell's background. */
	bar?: number
	/** Makes the row header a button: a click on the row filters by it. */
	onSelect?: () => void
	/** One cell per column, in column order. */
	cells: ReactNode[]
}

/** @beta */
export interface DataTableProps {
	/** The table's accessible name, which a visible heading beside it usually already says. */
	label: string
	/** The row headers' column. */
	labelHeader: string
	columns: DataTableColumn[]
	rows: DataTableRow[]
	/**
	 * Draws each row's share as a bar behind its label: `solid` in the chart color, `soft` paled with a
	 * dark label. Left out, the table is a plain one.
	 */
	bars?: 'solid' | 'soft'
	/**
	 * `hidden` keeps the header row for assistive tech only, for a list whose card names it;
	 * `none` draws none, for a caller with no column names to give.
	 */
	head?: 'visible' | 'hidden' | 'none'
	/** Said in place of the table when there are no rows. */
	emptyLabel?: string
	/** What a row's button does ("Filter by Page"), read after its label. */
	filterHint?: string
	/** Cuts a long label short on one line, its full text kept in the cell's title. */
	truncate?: boolean
	/** Read out for a cell showing the dash of a missing reading. */
	noValueLabel?: string
	className?: string
}

interface Hover {
	i: number
	x: number
	y: number
}

/** A path or an address, which reads left to right whichever way the page does. */
const LEFT_TO_RIGHT = /^(\/|[a-z][a-z\d+.-]*:\/\/)/i

/** Payload's chevron (icons/Chevron), drawn here so a chart outside the admin needs no Payload UI. */
const SortArrow = ({ direction }: { direction: SortDirection }) => (
	<svg
		aria-hidden="true"
		className={`analytics-table__sort-arrow analytics-table__sort-arrow--${direction}`}
		focusable="false"
		height="12"
		viewBox="0 0 20 20"
		width="12"
	>
		<path d="M14 8L10 12L6 8" />
	</svg>
)

/**
 * A row header's text: the decoration, then the label in its own direction, so in a right-to-left
 * row `/pricing` never reads `pricing/`. Wrapped to carry the bar's colors or to be cut short.
 */
function RowLabel({
	row,
	barred,
	truncate,
}: {
	row: DataTableRow
	barred: boolean
	truncate: boolean
}) {
	const direction = LEFT_TO_RIGHT.test(row.label) ? { dir: 'ltr' } : {}
	const name = (
		<>
			{row.decoration === undefined ? null : (
				<span aria-hidden="true" className="analytics-bars__decoration">
					{row.decoration}
				</span>
			)}
			<bdi>{row.label}</bdi>
		</>
	)
	if (barred) {
		return (
			<span className="analytics-bars__label" {...direction}>
				{name}
			</span>
		)
	}
	if (truncate) {
		return (
			<span className="analytics-table__label-text" title={row.label} {...direction}>
				{name}
			</span>
		)
	}
	return name
}

/**
 * The label where it identifies the row, with the rank only for an empty or repeated label: React
 * strands duplicate keys, and keying by rank alone would remount every row when the ranking moved.
 */
export const rowKeys = (rows: ReadonlyArray<{ label: string }>): string[] => {
	const seen = new Set<string>()
	return rows.map((row, i) => {
		const key = row.label === '' ? `#${i}` : row.label
		if (seen.has(key)) {
			return `${key}#${i}`
		}
		seen.add(key)
		return key
	})
}

/**
 * True once the wrapper scrolls sideways, which is when a keyboard needs a stop on it to scroll:
 * a table that fits takes no extra tab stop.
 */
const useOverflows = (ref: RefObject<HTMLDivElement | null>, drawn: boolean): boolean => {
	const [overflows, setOverflows] = useState(false)
	useEffect(() => {
		const element = ref.current
		if (!drawn || !element || typeof ResizeObserver === 'undefined') {
			return
		}
		const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(element)
		const table = element.firstElementChild
		if (table) {
			observer.observe(table)
		}
		return () => observer.disconnect()
	}, [ref, drawn])
	return overflows
}

/**
 * The table every list is drawn as, with real `<table>` semantics: sortable `<th aria-sort>`
 * headers, each label a row header holding its filter button, its share as the cell's background.
 *
 * @beta
 */
export function DataTable({
	label,
	labelHeader,
	columns,
	rows,
	bars,
	head = 'visible',
	emptyLabel,
	filterHint,
	truncate = false,
	noValueLabel,
	className,
}: DataTableProps) {
	const scroller = useRef<HTMLDivElement>(null)
	const hintId = useId()
	const overflows = useOverflows(scroller, rows.length > 0)
	const [hover, setHover] = useState<Hover | null>(null)
	const [hovering, setHovering] = useState(rows)
	// The hover is a row index, which means nothing once the rows are someone else's: a
	// refiltered list would otherwise keep the tooltip open over whatever now sits at that rank.
	if (hovering !== rows) {
		setHovering(rows)
		setHover(null)
	}
	useDismissOnEscape(hover !== null, () => setHover(null))
	if (rows.length === 0) {
		return emptyLabel === undefined ? null : (
			<span className="analytics-bars__empty">{emptyLabel}</span>
		)
	}
	const barred = bars !== undefined
	const track = (i: number) => (event: PointerEvent<HTMLElement>) =>
		setHover({ i, x: event.clientX, y: event.clientY })
	// A keyboard reaches the full label the way a pointer does, but only where it is cut short.
	const focusTrack = (i: number) => (event: FocusEvent<HTMLElement>) => {
		const cut = event.currentTarget.querySelector('.analytics-bars__label')
		if (!cut || cut.scrollWidth <= cut.clientWidth) {
			return
		}
		const box = event.currentTarget.getBoundingClientRect()
		setHover({ i, x: box.left + box.width / 2, y: box.top })
	}
	const hovered = hover ? rows[hover.i] : undefined
	const tableClass = classNames(
		'analytics-table',
		barred && 'analytics-bars',
		bars === 'soft' && 'analytics-bars--soft',
		truncate && 'analytics-table--truncate',
		className
	)

	// A table wider than its card scrolls, and a keyboard can only scroll what it can reach; the
	// stop is a region only when there is a name to give it.
	const regionName = label || labelHeader
	const scrollable = overflows
		? { tabIndex: 0, ...(regionName ? { 'aria-label': regionName, role: 'region' } : {}) }
		: {}
	const describedBy = filterHint ? { 'aria-describedby': hintId } : {}

	return (
		<div className="analytics-table__scroll" ref={scroller} {...scrollable}>
			<table aria-label={label === '' ? undefined : label} className={tableClass}>
				{head === 'none' ? null : (
					<thead className={head === 'hidden' ? 'analytics-sr-only' : undefined}>
						<tr>
							<th className="analytics-table__label" scope="col">
								{labelHeader}
							</th>
							{columns.map((column) => (
								<th
									{...(column.sorted ? { 'aria-sort': column.sorted } : {})}
									className={column.headerClassName}
									key={column.key}
									scope="col"
								>
									{column.onSort ? (
										<button className="analytics-table__sort" onClick={column.onSort} type="button">
											{column.header}
											{column.sorted ? <SortArrow direction={column.sorted} /> : null}
										</button>
									) : (
										column.header
									)}
								</th>
							))}
						</tr>
					</thead>
				)}
				<tbody>
					{rows.map((row, i) => {
						const content = <RowLabel barred={barred} row={row} truncate={truncate} />
						return (
							<tr
								className={classNames(
									'analytics-bars__row',
									row.onSelect && 'analytics-bars__row--action'
								)}
								key={row.key}
								style={{ '--analytics-bar': cssPercent(row.bar ?? 0) }}
								{...(barred
									? {
											onPointerEnter: track(i),
											onPointerLeave: () => setHover(null),
											onPointerMove: track(i),
										}
									: {})}
							>
								<th className="analytics-table__label" scope="row">
									{row.onSelect ? (
										<button
											{...describedBy}
											className={classNames(
												barred && 'analytics-bars__track',
												'analytics-table__filter'
											)}
											onClick={row.onSelect}
											type="button"
											{...(barred ? { onBlur: () => setHover(null), onFocus: focusTrack(i) } : {})}
										>
											{content}
										</button>
									) : barred ? (
										<span className="analytics-bars__track">{content}</span>
									) : (
										content
									)}
								</th>
								{row.cells.map((cell, index) => (
									<td className={columns[index]?.className} key={columns[index]?.key ?? index}>
										{shownValue(cell, noValueLabel)}
									</td>
								))}
							</tr>
						)
					})}
				</tbody>
			</table>
			{filterHint ? (
				<span className="analytics-sr-only" id={hintId}>
					{filterHint}
				</span>
			) : null}
			{hover && hovered ? (
				<div
					className="analytics-chart__tooltip analytics-chart__tooltip--pointer"
					style={{ '--analytics-x': cssPx(hover.x), '--analytics-y': cssPx(hover.y) }}
				>
					<div className="analytics-chart__tooltip-label">
						<bdi>{hovered.label}</bdi>
					</div>
					<div className="analytics-chart__tooltip-value">{hovered.cells[0]}</div>
				</div>
			) : null}
		</div>
	)
}
