import { shownValue } from './NoValue'
import '../analytics.css'

/** @beta */
export interface ChartDataRow {
	key: string
	/** The bucket, as the tooltip names it. */
	period: string
	value: string
	/** The previous period's reading for the same bucket. */
	previous?: string
}

/** @beta */
export interface ChartDataTableProps {
	/** Names the table, as the chart's own label names the chart. */
	caption: string
	/** The buckets' column; left out, that header cell is blank. */
	periodLabel?: string
	/** The series' column. */
	valueLabel: string
	/** The comparison's column, drawn only when it is given. */
	comparisonLabel?: string
	rows: ChartDataRow[]
	/** Read out for a bucket showing the dash of a missing reading. */
	noValueLabel?: string
}

/**
 * A chart's numbers as a table only assistive tech sees, beside the hidden SVG, so a screen reader
 * walks every bucket instead of hearing a picture described.
 *
 * @beta
 */
export function ChartDataTable({
	caption,
	periodLabel,
	valueLabel,
	comparisonLabel,
	rows,
	noValueLabel,
}: ChartDataTableProps) {
	const compared = comparisonLabel !== undefined
	// Hidden through a wrapper: a table grows to its rows whatever height it is given, so hidden
	// itself it would still stretch the page by every row.
	return (
		<div className="analytics-sr-only">
			<table className="analytics-chart__table">
				<caption>{caption}</caption>
				<thead>
					<tr>
						{periodLabel === undefined ? <td /> : <th scope="col">{periodLabel}</th>}
						<th scope="col">{valueLabel}</th>
						{compared ? <th scope="col">{comparisonLabel}</th> : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.key}>
							<th scope="row">{row.period}</th>
							<td>{shownValue(row.value, noValueLabel)}</td>
							{compared ? <td>{shownValue(row.previous ?? '', noValueLabel)}</td> : null}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
