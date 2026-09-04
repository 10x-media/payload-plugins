import { type ScalarUnitId, UNITS, type UnitDef } from './units'

export const roundTo = (value: number, digits: number): number => {
	const p = 10 ** digits
	return Math.round((value + Number.EPSILON * Math.sign(value)) * p) / p
}

/** Converts between two scalar units of the same dimension via the dimension canonical. */
export const convert = (value: number, from: ScalarUnitId, to: ScalarUnitId): number => {
	if (from === to) return value
	const f: UnitDef = UNITS[from]
	const t: UnitDef = UNITS[to]
	if (f.dimension !== t.dimension) {
		throw new Error(
			`Cannot convert ${from} (${f.dimension}) to ${to} (${t.dimension}): dimension mismatch`
		)
	}
	const canonical = value * f.factor + (f.offset ?? 0)
	return (canonical - (t.offset ?? 0)) / t.factor
}
