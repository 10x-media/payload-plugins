export interface SplineGeometry {
	line: string
	area: string
}

export interface SplineOptions {
	width: number
	height: number
	padding?: number
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Fritsch-Carlson monotone tangents for a unit-spaced series: endpoints take the
 * adjacent secant, interior points the average of neighbouring secants, then each is
 * clamped so the cubic never overshoots (no wiggle between points).
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
 * Build SVG path strings for a monotone-cubic line and its closed area fill, mapping a
 * value series into a `width` x `height` box (y normalized to the value range; flat or
 * single-value series sit on the vertical midline).
 */
export const monotoneAreaPath = (values: number[], opts: SplineOptions): SplineGeometry => {
	const { width, height } = opts
	const padding = opts.padding ?? 0
	if (values.length === 0) {
		return { line: '', area: '' }
	}
	const innerH = height - padding * 2
	const max = Math.max(...values)
	const min = Math.min(...values)
	const span = max - min || 1
	const x = (i: number): number => round(values.length > 1 ? (i / (values.length - 1)) * width : 0)
	const y = (v: number): number =>
		round(max === min ? height / 2 : padding + innerH - ((v - min) / span) * innerH)
	const v0 = values[0] ?? 0
	if (values.length === 1) {
		const line = `M0,${y(v0)} L${round(width)},${y(v0)}`
		return { line, area: '' }
	}
	const tangents = computeTangents(values)
	let line = `M${x(0)},${y(v0)}`
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
	const area = `${line} L${x(values.length - 1)},${round(height)} L${x(0)},${round(height)} Z`
	return { line, area }
}
