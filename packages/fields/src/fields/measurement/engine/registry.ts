import { convertUnit, roundTo } from './convert'
import {
	compose as composeBuiltIn,
	decompose as decomposeBuiltIn,
	type FormattableUnit,
	formatMeasurement as formatMeasurementBuiltIn,
	formatScalarValue,
	scalarLongLabelFor,
	unitLabel as unitLabelBuiltIn,
} from './format'
import { DIMENSION_LOCALE_DEFAULTS } from './locale'
import {
	COMPOUND_MINOR_PRECISION,
	COMPOUNDS,
	type CompoundUnitId,
	DISPLAY_PRECISION,
	isScalarUnit as isBuiltInScalarUnit,
	type ScalarUnitId,
	UNITS,
	unitsOfDimension as unitsOfDimensionBuiltIn,
} from './units'

export type CustomUnitDef = {
	dimension: string
	factor: number
	offset?: number
	/** ECMA-402 unit identifier, or null when there is none: formatting falls back to plain decimal + shortLabel. */
	intlUnit: string | null
	shortLabel: string
	/** Display fraction digits for this unit. Defaults to 2 when omitted. */
	precision?: number
}

export type CustomDimensionDef = {
	/** Must name one of `custom.units` for this dimension, with factor 1 and no offset. */
	canonicalUnit: string
}

export type MeasurementCustomConfig = {
	units?: Record<string, CustomUnitDef>
	dimensions?: Record<string, CustomDimensionDef>
}

export type EngineFormatMeasurementOptions = {
	storageUnit: string
	displayUnit: string
	locale: string
	unitDisplay?: 'long' | 'narrow' | 'short'
	precision?: Partial<Record<string, number>>
}

type MergedUnit = FormattableUnit & {
	dimension: string
	factor: number
	offset?: number
	precision: number
}

const CORE_DIMENSIONS = new Set<string>(Object.keys(DIMENSION_LOCALE_DEFAULTS))

const isCompoundUnitId = (unit: string): unit is CompoundUnitId => Object.hasOwn(COMPOUNDS, unit)

const mergeUnits = (custom?: MeasurementCustomConfig): Record<string, MergedUnit> => {
	const customUnits = custom?.units ?? {}
	const customDimensions = custom?.dimensions ?? {}

	for (const dimensionId of Object.keys(customDimensions)) {
		if (CORE_DIMENSIONS.has(dimensionId)) {
			throw new Error(`Custom dimension "${dimensionId}" collides with a built-in dimension`)
		}
	}

	const units: Record<string, MergedUnit> = {}
	for (const id of Object.keys(UNITS) as ScalarUnitId[]) {
		units[id] = { ...UNITS[id], precision: DISPLAY_PRECISION[id] }
	}

	for (const [id, def] of Object.entries(customUnits)) {
		if (Object.hasOwn(UNITS, id) || Object.hasOwn(COMPOUNDS, id)) {
			throw new Error(`Custom unit "${id}" collides with a built-in unit id`)
		}
		// Unreachable while customUnits is a plain object (keys are already unique), but
		// kept as a guard against a future custom-unit source that permits duplicates.
		if (Object.hasOwn(units, id)) {
			throw new Error(`Custom unit "${id}" collides with another custom unit id`)
		}
		if (!CORE_DIMENSIONS.has(def.dimension) && !Object.hasOwn(customDimensions, def.dimension)) {
			throw new Error(
				`Custom unit "${id}" references unknown dimension "${def.dimension}": declare it in custom.dimensions or use a built-in dimension`
			)
		}
		units[id] = {
			dimension: def.dimension,
			factor: def.factor,
			offset: def.offset,
			intlUnit: def.intlUnit,
			shortLabel: def.shortLabel,
			precision: def.precision ?? 2,
		}
	}

	for (const [dimensionId, def] of Object.entries(customDimensions)) {
		const canonical = units[def.canonicalUnit]
		if (!canonical || canonical.dimension !== dimensionId) {
			throw new Error(
				`Custom dimension "${dimensionId}" canonicalUnit "${def.canonicalUnit}" must be a custom unit declared for dimension "${dimensionId}"`
			)
		}
		if (canonical.factor !== 1 || typeof canonical.offset !== 'undefined') {
			throw new Error(
				`Custom dimension "${dimensionId}" canonicalUnit "${def.canonicalUnit}" must have factor 1 and no offset`
			)
		}
	}

	return units
}

/**
 * Builds a measurement engine over the built-in units merged with a serializable custom
 * config. Compound units (ft-in, st-lb) are always built-in: custom units are scalar-only,
 * so decompose/compose run on the built-in table, bridged for a custom storage unit.
 */
export const createEngine = (custom?: MeasurementCustomConfig) => {
	const units = mergeUnits(custom)

	const getUnit = (unit: string): MergedUnit => {
		const def = units[unit]
		if (!def) throw new Error(`Unknown unit "${unit}"`)
		return def
	}

	const convert = (value: number, from: string, to: string): number =>
		convertUnit(units, value, from, to)

	const isScalarUnit = (unit: string): boolean => Object.hasOwn(units, unit)

	// Compound units are built-in and split on the built-in table, so a custom
	// storage unit is bridged through the compound's own major unit.
	// biome-ignore lint/complexity/useMaxParams: mirrors the built-in decompose signature
	const decompose = (
		value: number,
		from: string,
		compound: CompoundUnitId,
		minorDigits?: number
	): { major: number; minor: number } => {
		if (isBuiltInScalarUnit(from)) return decomposeBuiltIn(value, from, compound, minorDigits)
		const bridge = COMPOUNDS[compound].major
		return decomposeBuiltIn(convert(value, from, bridge), bridge, compound, minorDigits)
	}

	const compose = (
		parts: { major: number; minor: number },
		compound: CompoundUnitId,
		to: string
	): number => {
		if (isBuiltInScalarUnit(to)) return composeBuiltIn(parts, compound, to)
		const bridge = COMPOUNDS[compound].major
		return convert(composeBuiltIn(parts, compound, bridge), bridge, to)
	}

	const dimensionOf = (unit: string): string =>
		isCompoundUnitId(unit) ? UNITS[COMPOUNDS[unit].major].dimension : getUnit(unit).dimension

	const unitsOfDimension = (dimension: string): string[] => {
		const customIds = Object.entries(custom?.units ?? {})
			.filter(([, def]) => def.dimension === dimension)
			.map(([id]) => id)
		return [...unitsOfDimensionBuiltIn(dimension), ...customIds]
	}

	const precisionFor = (unit: string, overrides?: Partial<Record<string, number>>): number => {
		const override = overrides?.[unit]
		if (typeof override === 'number') return override
		return isCompoundUnitId(unit) ? COMPOUND_MINOR_PRECISION[unit] : getUnit(unit).precision
	}

	const unitLabel = (unit: string, locale: string, style: 'long' | 'short'): string => {
		if (isCompoundUnitId(unit)) return unitLabelBuiltIn(unit, locale, style)
		const def = getUnit(unit)
		return style === 'short' ? def.shortLabel : scalarLongLabelFor(def, locale)
	}

	const formatMeasurement = (value: number, opts: EngineFormatMeasurementOptions): string => {
		const { displayUnit, locale, precision, storageUnit, unitDisplay = 'short' } = opts
		if (isCompoundUnitId(displayUnit)) {
			const bridge = COMPOUNDS[displayUnit].major
			const builtInStorage = isBuiltInScalarUnit(storageUnit)
			return formatMeasurementBuiltIn(
				builtInStorage ? value : convert(value, storageUnit, bridge),
				{
					...opts,
					storageUnit: builtInStorage ? storageUnit : bridge,
					displayUnit,
				}
			)
		}
		const digits = precisionFor(displayUnit, precision)
		return formatScalarValue(roundTo(convert(value, storageUnit, displayUnit), digits), {
			digits,
			locale,
			unit: getUnit(displayUnit),
			unitDisplay,
		})
	}

	return {
		compose,
		convert,
		decompose,
		dimensionOf,
		formatMeasurement,
		isCompoundUnit: isCompoundUnitId,
		isScalarUnit,
		precisionFor,
		unitLabel,
		unitsOfDimension,
	}
}

export type MeasurementEngine = ReturnType<typeof createEngine>

export const defaultEngine: MeasurementEngine = createEngine()
