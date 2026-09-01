export type Dimension = 'length' | 'mass' | 'speed' | 'temperature' | 'volume'

export type ScalarUnitId =
	| 'c'
	| 'cm'
	| 'f'
	| 'fl-oz'
	| 'ft'
	| 'g'
	| 'gal'
	| 'in'
	| 'kg'
	| 'km'
	| 'km/h'
	| 'l'
	| 'lb'
	| 'm'
	| 'm/s'
	| 'mi'
	| 'ml'
	| 'mm'
	| 'mph'
	| 'oz'
	| 'st'
	| 'yd'

export type CompoundUnitId = 'ft-in' | 'st-lb'
export type UnitId = CompoundUnitId | ScalarUnitId

/**
 * canonical = value * factor + offset, per dimension canonical (kg, m, l,
 * celsius, m/s). Factors are the exact statute definitions where one exists.
 */
export type UnitDef = {
	dimension: Dimension
	factor: number
	offset?: number
	/** ECMA-402 sanctioned unit identifier for Intl.NumberFormat. */
	intlUnit: string
	/** Static short symbol for the in-row unit affordance. */
	shortLabel: string
}

export type CompoundDef = { major: ScalarUnitId; minor: ScalarUnitId; ratio: number }

const LB = 0.45359237
const IN = 0.0254

export const UNITS: Record<ScalarUnitId, UnitDef> = {
	g: { dimension: 'mass', factor: 0.001, intlUnit: 'gram', shortLabel: 'g' },
	kg: { dimension: 'mass', factor: 1, intlUnit: 'kilogram', shortLabel: 'kg' },
	oz: { dimension: 'mass', factor: LB / 16, intlUnit: 'ounce', shortLabel: 'oz' },
	lb: { dimension: 'mass', factor: LB, intlUnit: 'pound', shortLabel: 'lb' },
	st: { dimension: 'mass', factor: 14 * LB, intlUnit: 'stone', shortLabel: 'st' },
	mm: { dimension: 'length', factor: 0.001, intlUnit: 'millimeter', shortLabel: 'mm' },
	cm: { dimension: 'length', factor: 0.01, intlUnit: 'centimeter', shortLabel: 'cm' },
	m: { dimension: 'length', factor: 1, intlUnit: 'meter', shortLabel: 'm' },
	km: { dimension: 'length', factor: 1000, intlUnit: 'kilometer', shortLabel: 'km' },
	in: { dimension: 'length', factor: IN, intlUnit: 'inch', shortLabel: 'in' },
	ft: { dimension: 'length', factor: 12 * IN, intlUnit: 'foot', shortLabel: 'ft' },
	yd: { dimension: 'length', factor: 36 * IN, intlUnit: 'yard', shortLabel: 'yd' },
	mi: { dimension: 'length', factor: 1609.344, intlUnit: 'mile', shortLabel: 'mi' },
	ml: { dimension: 'volume', factor: 0.001, intlUnit: 'milliliter', shortLabel: 'ml' },
	l: { dimension: 'volume', factor: 1, intlUnit: 'liter', shortLabel: 'l' },
	'fl-oz': {
		dimension: 'volume',
		factor: 0.0295735295625,
		intlUnit: 'fluid-ounce',
		shortLabel: 'fl oz',
	},
	gal: { dimension: 'volume', factor: 3.785411784, intlUnit: 'gallon', shortLabel: 'gal' },
	c: { dimension: 'temperature', factor: 1, intlUnit: 'celsius', shortLabel: '°C' },
	f: {
		dimension: 'temperature',
		factor: 5 / 9,
		offset: -160 / 9,
		intlUnit: 'fahrenheit',
		shortLabel: '°F',
	},
	'km/h': {
		dimension: 'speed',
		factor: 1000 / 3600,
		intlUnit: 'kilometer-per-hour',
		shortLabel: 'km/h',
	},
	mph: { dimension: 'speed', factor: 0.44704, intlUnit: 'mile-per-hour', shortLabel: 'mph' },
	'm/s': { dimension: 'speed', factor: 1, intlUnit: 'meter-per-second', shortLabel: 'm/s' },
}

export const COMPOUNDS: Record<CompoundUnitId, CompoundDef> = {
	'ft-in': { major: 'ft', minor: 'in', ratio: 12 },
	'st-lb': { major: 'st', minor: 'lb', ratio: 14 },
}

export const isCompoundUnit = (unit: UnitId): unit is CompoundUnitId =>
	Object.hasOwn(COMPOUNDS, unit)
export const isScalarUnit = (unit: string): unit is ScalarUnitId => Object.hasOwn(UNITS, unit)

export const dimensionOf = (unit: UnitId): Dimension =>
	isCompoundUnit(unit) ? UNITS[COMPOUNDS[unit].major].dimension : UNITS[unit].dimension

/** Values round-trip through display without visible drift at these precisions. */
export const DISPLAY_PRECISION: Record<ScalarUnitId, number> = {
	g: 0,
	kg: 1,
	oz: 0,
	lb: 0,
	st: 0,
	mm: 0,
	cm: 0,
	m: 2,
	km: 1,
	in: 1,
	ft: 1,
	yd: 1,
	mi: 1,
	ml: 0,
	l: 2,
	'fl-oz': 1,
	gal: 2,
	c: 1,
	f: 0,
	'km/h': 0,
	mph: 0,
	'm/s': 1,
}

export const COMPOUND_MINOR_PRECISION: Record<CompoundUnitId, number> = { 'ft-in': 0, 'st-lb': 0 }

export const STORAGE_FRACTION_DIGITS = 6

export const precisionFor = (unit: UnitId, overrides?: Partial<Record<UnitId, number>>): number => {
	const override = overrides?.[unit]
	if (typeof override === 'number') return override
	return isCompoundUnit(unit) ? COMPOUND_MINOR_PRECISION[unit] : DISPLAY_PRECISION[unit]
}
