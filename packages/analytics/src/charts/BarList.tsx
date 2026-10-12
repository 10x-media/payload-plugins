'use client'

import { NO_VALUE } from '../core/metricValues'
import { DataTable, type DataTableColumn, rowKeys } from '../ui/components/DataTable'
import { type BarDatum, toBarRows } from './bars'
import '../ui/analytics.css'

/** @beta */
export interface BarListHeaders {
	/** What the rows are: "Page", "Country". */
	label: string
	/** The barred value's column. */
	value: string
	secondary?: string
	tertiary?: string
	quaternary?: string
}

/** @beta */
export interface BarListProps {
	data: BarDatum[]
	emptyLabel: string
	/**
	 * Makes each selectable row's label a button reporting its index. Left out, rows are inert: a source
	 * that cannot filter by the dimension must not offer a click that does nothing.
	 */
	onSelect?: (index: number) => void
	/**
	 * `solid` (default) fills the bar in the chart color, the label light over it and dark past it;
	 * `soft` pales the fill and keeps the label dark, for a denser list.
	 */
	fill?: 'solid' | 'soft'
	/** The list's accessible name. */
	label?: string
	/** Column names for assistive tech; the list draws no header row. */
	headers?: BarListHeaders
}

const EXTRA_COLUMNS = ['secondary', 'tertiary', 'quaternary'] as const

/**
 * Ranked horizontal bar list, drawn as a table whose label cells carry each bar as their background,
 * so assistive tech reads it as one. Dependency-free; styled by the package stylesheet.
 *
 * @beta
 */
export function BarList({
	data,
	emptyLabel,
	onSelect,
	fill = 'solid',
	label,
	headers,
}: BarListProps) {
	const rows = toBarRows(data)
	const keys = rowKeys(rows)
	const extras = EXTRA_COLUMNS.filter((column) => rows.some((row) => row[column] !== undefined))
	const columns: DataTableColumn[] = [
		{ key: 'value', header: headers?.value ?? '', className: 'analytics-bars__value' },
		...extras.map((column) => ({
			key: column,
			header: headers?.[column] ?? '',
			className: `analytics-bars__${column}`,
		})),
	]
	return (
		<DataTable
			bars={fill}
			columns={columns}
			emptyLabel={emptyLabel}
			head={headers ? 'hidden' : 'none'}
			label={label ?? headers?.label ?? ''}
			labelHeader={headers?.label ?? ''}
			rows={rows.map((row, i) => ({
				key: keys[i] ?? String(i),
				label: row.label,
				bar: row.fraction,
				...(row.decoration === undefined ? {} : { decoration: row.decoration }),
				...(onSelect && row.selectable !== false ? { onSelect: () => onSelect(i) } : {}),
				cells: [
					row.display ?? (row.value === null ? NO_VALUE : String(row.value)),
					...extras.map((column) => row[column] ?? ''),
				],
			}))}
		/>
	)
}
