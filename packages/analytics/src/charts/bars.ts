export interface BarDatum {
	label: string
	value: number
	display?: string
	/** A second, unbarred column (the view's `visitors` beside the charted metric). */
	secondary?: string
	/** `false` keeps this one row inert in a list that is otherwise selectable. */
	selectable?: boolean
}

export interface BarRow {
	label: string
	value: number
	fraction: number
	display?: string
	secondary?: string
	selectable?: boolean
}

/**
 * Scale each datum's value to a `[0, 1]` fraction of the largest value, for a ranked
 * bar list. A degenerate all-zero set yields zero fractions (no bar), never a divide
 * by zero.
 */
export const toBarRows = (data: BarDatum[]): BarRow[] => {
	const max = data.reduce((m, d) => Math.max(m, d.value), 0)
	return data.map((d) => ({
		label: d.label,
		value: d.value,
		fraction: max > 0 ? d.value / max : 0,
		display: d.display,
		secondary: d.secondary,
		selectable: d.selectable,
	}))
}
