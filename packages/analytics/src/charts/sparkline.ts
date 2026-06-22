export interface SparklineGeometry {
	line: string
	area: string
}

export interface SparklineOptions {
	width: number
	height: number
	padding?: number
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Map a series of values to SVG path strings for a line and its filled area within a
 * `width` x `height` box. The y-axis is normalized to the value range so the line
 * uses the full height; a flat (or single-value) series renders along the vertical
 * middle.
 */
export const buildSparkline = (values: number[], opts: SparklineOptions): SparklineGeometry => {
	const { width, height } = opts
	const padding = opts.padding ?? 1
	if (values.length === 0) {
		return { line: '', area: '' }
	}
	const first = values[0] ?? 0
	const pts = values.length === 1 ? [first, first] : values
	const n = pts.length
	const max = Math.max(...pts)
	const min = Math.min(...pts)
	const span = max - min || 1
	const innerH = height - padding * 2
	const x = (i: number): number => round((i / (n - 1)) * width)
	const y = (v: number): number =>
		round(max === min ? height / 2 : padding + innerH - ((v - min) / span) * innerH)
	const coords = pts.map((v, i) => `${x(i)},${y(v)}`)
	const line = `M${coords.join(' L')}`
	const area = `M${x(0)},${round(height)} L${coords.join(' L')} L${x(n - 1)},${round(height)} Z`
	return { line, area }
}
