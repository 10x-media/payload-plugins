import { convert, roundTo } from './convert'
import {
	COMPOUNDS,
	type CompoundUnitId,
	isCompoundUnit,
	precisionFor,
	type ScalarUnitId,
	UNITS,
	type UnitId,
} from './units'

export type FormatMeasurementOptions = {
	storageUnit: ScalarUnitId
	displayUnit: UnitId
	locale: string
	unitDisplay?: 'long' | 'narrow' | 'short'
	precision?: Partial<Record<UnitId, number>>
}

/**
 * Splits a stored scalar into compound major/minor parts. The minor is rounded
 * to its display precision BEFORE deriving the major so 5 ft 11.996 in carries
 * to 6 ft 0 in rather than printing an impossible 5 ft 12 in.
 */
// biome-ignore lint/complexity/useMaxParams: designed interface for measurement decomposition
export const decompose = (
	value: number,
	from: ScalarUnitId,
	compound: CompoundUnitId,
	minorDigits?: number
): { major: number; minor: number } => {
	const def = COMPOUNDS[compound]
	const digits = minorDigits ?? precisionFor(compound)
	const sign = value < 0 ? -1 : 1
	const totalMinor = roundTo(Math.abs(convert(value, from, def.minor)), digits)
	const major = Math.floor(totalMinor / def.ratio)
	const minor = roundTo(totalMinor - major * def.ratio, digits)
	return { major: sign * major + 0, minor: sign * minor + 0 }
}

export const compose = (
	parts: { major: number; minor: number },
	compound: CompoundUnitId,
	to: ScalarUnitId
): number => {
	const def = COMPOUNDS[compound]
	return convert(parts.major * def.ratio + parts.minor, def.minor, to)
}

// biome-ignore lint/complexity/useMaxParams: Intl.NumberFormat options require locale and formatting parameters
const scalarFormatter = (
	unit: ScalarUnitId,
	locale: string,
	digits: number,
	unitDisplay: 'long' | 'narrow' | 'short'
): Intl.NumberFormat =>
	new Intl.NumberFormat(locale, {
		maximumFractionDigits: digits,
		style: 'unit',
		unit: UNITS[unit].intlUnit,
		unitDisplay,
	})

/** Minimal shape formatting needs, so createEngine can format custom units alongside built-ins. */
export type FormattableUnit = { intlUnit: string | null; shortLabel: string }

export type ScalarFormatOptions = {
	unit: FormattableUnit
	locale: string
	digits: number
	unitDisplay: 'long' | 'narrow' | 'short'
}

/** intlUnit null means the unit has no ECMA-402 identifier: fall back to plain decimal + shortLabel. */
export const formatScalarValue = (value: number, opts: ScalarFormatOptions): string => {
	const { digits, locale, unit, unitDisplay } = opts
	if (unit.intlUnit === null) {
		return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${unit.shortLabel}`
	}
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: digits,
		style: 'unit',
		unit: unit.intlUnit,
		unitDisplay,
	}).format(value)
}

const joinParts = (parts: string[], locale: string): string => {
	try {
		return new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' }).format(parts)
	} catch {
		return parts.join(' ')
	}
}

export const formatMeasurement = (value: number, opts: FormatMeasurementOptions): string => {
	const { displayUnit, locale, precision, storageUnit, unitDisplay = 'short' } = opts
	if (isCompoundUnit(displayUnit)) {
		const def = COMPOUNDS[displayUnit]
		const { major, minor } = decompose(
			value,
			storageUnit,
			displayUnit,
			precisionFor(displayUnit, precision)
		)
		const majorText = scalarFormatter(def.major, locale, 0, unitDisplay).format(major)
		const minorText = scalarFormatter(
			def.minor,
			locale,
			precisionFor(displayUnit, precision),
			unitDisplay
		).format(minor)
		return joinParts([majorText, minorText], locale)
	}
	const digits = precisionFor(displayUnit, precision)
	return formatScalarValue(roundTo(convert(value, storageUnit, displayUnit), digits), {
		digits,
		locale,
		unit: UNITS[displayUnit],
		unitDisplay,
	})
}

/** intlUnit null means the unit has no ECMA-402 identifier: fall back to the shortLabel as-is. */
export const scalarLongLabelFor = (unit: FormattableUnit, locale: string): string => {
	if (unit.intlUnit === null) return unit.shortLabel
	const parts = new Intl.NumberFormat(locale, {
		style: 'unit',
		unit: unit.intlUnit,
		unitDisplay: 'long',
	}).formatToParts(2)
	const unitPart = parts.find((part) => part.type === 'unit')
	return unitPart?.value ?? unit.shortLabel
}

const scalarLongLabel = (unit: ScalarUnitId, locale: string): string =>
	scalarLongLabelFor(UNITS[unit], locale)

/** Picker label for a unit. Long labels come from Intl so they localize for free. */
export const unitLabel = (unit: UnitId, locale: string, style: 'long' | 'short'): string => {
	if (isCompoundUnit(unit)) {
		const def = COMPOUNDS[unit]
		if (style === 'short') return `${UNITS[def.major].shortLabel} ${UNITS[def.minor].shortLabel}`
		const major = scalarLongLabel(def.major, locale)
		const minor = scalarLongLabel(def.minor, locale)
		try {
			return new Intl.ListFormat(locale, { style: 'long', type: 'unit' }).format([major, minor])
		} catch {
			return `${major} ${minor}`
		}
	}
	return style === 'short' ? UNITS[unit].shortLabel : scalarLongLabel(unit, locale)
}
