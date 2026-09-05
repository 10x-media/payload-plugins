import { type ScalarUnitId, UNITS } from './units'

export const roundTo = (value: number, digits: number): number => {
	const p = 10 ** digits
	return Math.round((value + Number.EPSILON * Math.sign(value)) * p) / p
}

/** Minimal shape convert needs, so createEngine can pass a merged built-in + custom unit table. */
export type ConversionUnit = { dimension: string; factor: number; offset?: number }

/** Converts between two units of the same dimension via the dimension canonical, over any unit table. */
// biome-ignore lint/complexity/useMaxParams: shared conversion core keyed by a caller-supplied unit table
export const convertUnit = (
	units: Record<string, ConversionUnit>,
	value: number,
	from: string,
	to: string
): number => {
	if (from === to) return value
	const f = units[from]
	const t = units[to]
	if (!f) throw new Error(`Unknown unit "${from}"`)
	if (!t) throw new Error(`Unknown unit "${to}"`)
	if (f.dimension !== t.dimension) {
		throw new Error(
			`Cannot convert ${from} (${f.dimension}) to ${to} (${t.dimension}): dimension mismatch`
		)
	}
	const canonical = value * f.factor + (f.offset ?? 0)
	return (canonical - (t.offset ?? 0)) / t.factor
}

export const convert = (value: number, from: ScalarUnitId, to: ScalarUnitId): number =>
	convertUnit(UNITS, value, from, to)
