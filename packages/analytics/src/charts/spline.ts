export interface SplineGeometry {
	line: string
	area: string
}

export interface SplineOptions {
	width: number
	height: number
	padding?: number
	/** Explicit value domain, so two series drawn on one chart share a y-scale. */
	domain?: { min: number; max: number }
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Fritsch-Carlson monotone tangents for a unit-spaced series, clamped so the cubic never overshoots
 * between points.
 */
export const computeTangents = (ys: number[]): number[] => {
	const n = ys.length
	if (n < 2) {
		return ys.map(() => 0)
	}
	const d = ys.slice(0, -1).map((y, i) => (ys[i + 1] ?? 0) - y)
	const m = ys.map((_, i) => {
		if (i === 0) return d[0] ?? 0
		if (i === n - 1) return d[n - 2] ?? 0
		return ((d[i - 1] ?? 0) + (d[i] ?? 0)) / 2
	})
	for (let i = 0; i < n - 1; i++) {
		const di = d[i] ?? 0
		if (di === 0) {
			m[i] = 0
			m[i + 1] = 0
			continue
		}
		const mi = m[i] ?? 0
		const mi1 = m[i + 1] ?? 0
		const a = mi / di
		const b = mi1 / di
		const s = a * a + b * b
		if (s > 9) {
			const t = 3 / Math.sqrt(s)
			m[i] = t * a * di
			m[i + 1] = t * b * di
		}
	}
	return m
}

/**
 * Maps a reading onto the box's height, unrounded: the domain (else the readings' own range) spans
 * the box inside its padding, and a flat or single-value series sits on the midline.
 */
export const plotY = (readings: number[], opts: SplineOptions): ((v: number) => number) => {
	const { height } = opts
	const padding = opts.padding ?? 0
	const innerH = height - padding * 2
	const max = opts.domain?.max ?? Math.max(...readings)
	const min = opts.domain?.min ?? Math.min(...readings)
	const span = max - min || 1
	return (v) => (max === min ? height / 2 : padding + innerH - ((v - min) / span) * innerH)
}

const yScale = (readings: number[], opts: SplineOptions): ((v: number) => number) => {
	const y = plotY(readings, opts)
	return (v) => round(y(v))
}

/** The monotone cubic through `values`, each placed at `x` of its index within them. */
const curveThrough = (
	values: number[],
	x: (i: number) => number,
	y: (v: number) => number
): string => {
	const tangents = computeTangents(values)
	let line = `M${x(0)},${y(values[0] ?? 0)}`
	for (let i = 0; i < values.length - 1; i++) {
		const x0 = i
		const x1 = i + 1
		const vi = values[i] ?? 0
		const vi1 = values[i + 1] ?? 0
		const ti = tangents[i] ?? 0
		const ti1 = tangents[i + 1] ?? 0
		const cp1x = round(x(x0 + 1 / 3))
		const cp1y = round(y(vi + ti / 3))
		const cp2x = round(x(x1 - 1 / 3))
		const cp2y = round(y(vi1 - ti1 / 3))
		line += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${x(x1)},${y(vi1)}`
	}
	return line
}

/**
 * SVG paths for a monotone-cubic line and its closed area fill in a `width` x `height` box; a flat
 * or single-value series sits on the vertical midline.
 */
export const monotoneAreaPath = (values: number[], opts: SplineOptions): SplineGeometry => {
	const { width, height } = opts
	if (values.length === 0) {
		return { line: '', area: '' }
	}
	const x = (i: number): number => round(values.length > 1 ? (i / (values.length - 1)) * width : 0)
	const y = yScale(values, opts)
	const v0 = values[0] ?? 0
	if (values.length === 1) {
		const line = `M0,${y(v0)} L${round(width)},${y(v0)}`
		return { line, area: '' }
	}
	const line = curveThrough(values, x, y)
	const area = `${line} L${x(values.length - 1)},${round(height)} L${x(0)},${round(height)} Z`
	return { line, area }
}

/** Index ranges of the unbroken runs of readings in a series, `end` inclusive. */
export const readingRuns = (
	values: Array<number | null>
): Array<{ start: number; end: number }> => {
	const runs: Array<{ start: number; end: number }> = []
	let start: number | null = null
	values.forEach((value, i) => {
		if (value === null) {
			if (start !== null) {
				runs.push({ start, end: i - 1 })
				start = null
			}
			return
		}
		start ??= i
	})
	if (start !== null) {
		runs.push({ start, end: values.length - 1 })
	}
	return runs
}

/**
 * {@link monotoneAreaPath} broken at every `null`, each run kept on the shared axes. A lone
 * reading has no line to stroke, so the caller marks it with a dot.
 */
export const monotoneAreaSegments = (
	values: Array<number | null>,
	opts: SplineOptions
): SplineGeometry => {
	const readings = values.filter((value): value is number => value !== null)
	if (readings.length === values.length) {
		return monotoneAreaPath(readings, opts)
	}
	if (readings.length === 0) {
		return { line: '', area: '' }
	}
	const y = yScale(readings, opts)
	const step = values.length > 1 ? opts.width / (values.length - 1) : 0
	const floor = round(opts.height)
	const lines: string[] = []
	const areas: string[] = []
	for (const { start, end } of readingRuns(values)) {
		if (end === start) {
			continue
		}
		const run = values.slice(start, end + 1).filter((value): value is number => value !== null)
		const x = (i: number): number => round((start + i) * step)
		const line = curveThrough(run, x, y)
		lines.push(line)
		areas.push(`${line} L${x(run.length - 1)},${floor} L${x(0)},${floor} Z`)
	}
	return { line: lines.join(' '), area: areas.join(' ') }
}
