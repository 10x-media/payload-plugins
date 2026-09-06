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

/** A label that may vary by locale: an exact string, or a map resolved via resolveLocalizedLabel. */
export type LocalizedLabel = string | Partial<Record<string, string>>

/**
 * Resolves a possibly-localized label: exact locale match, then the language prefix
 * (de for de-AT), then the 'en' entry, then whichever value comes first, so a partial
 * map never renders blank. A plain string passes through unchanged.
 */
export const resolveLocalizedLabel = (label: LocalizedLabel, locale: string): string => {
	if (typeof label === 'string') return label
	const exact = label[locale]
	if (exact !== undefined) return exact
	const [prefix] = locale.split('-')
	const byPrefix = prefix ? label[prefix] : undefined
	if (byPrefix !== undefined) return byPrefix
	if (label.en !== undefined) return label.en
	return Object.values(label)[0] ?? ''
}

/**
 * Formatters are pure functions of locale + options, so every call site sharing a
 * combination reuses one instance instead of paying Intl construction per call: list
 * views can format hundreds of cells per render. Capped and cleared wholesale on
 * overflow rather than tracking LRU order, since a repo's locale/unit/digit combinations
 * are small and bounded in practice.
 */
const MAX_FORMATTER_CACHE_SIZE = 200
const numberFormatCache = new Map<string, Intl.NumberFormat>()
const listFormatCache = new Map<string, Intl.ListFormat>()

const getNumberFormatter = (
	locale: string,
	options: Intl.NumberFormatOptions
): Intl.NumberFormat => {
	const key = `${locale}|${options.style ?? ''}|${options.unit ?? ''}|${options.unitDisplay ?? ''}|${options.maximumFractionDigits ?? ''}`
	const cached = numberFormatCache.get(key)
	if (cached) return cached
	if (numberFormatCache.size >= MAX_FORMATTER_CACHE_SIZE) numberFormatCache.clear()
	const formatter = new Intl.NumberFormat(locale, options)
	numberFormatCache.set(key, formatter)
	return formatter
}

const getListFormatter = (locale: string, style: 'long' | 'narrow'): Intl.ListFormat => {
	const key = `${locale}|${style}`
	const cached = listFormatCache.get(key)
	if (cached) return cached
	if (listFormatCache.size >= MAX_FORMATTER_CACHE_SIZE) listFormatCache.clear()
	const formatter = new Intl.ListFormat(locale, { style, type: 'unit' })
	listFormatCache.set(key, formatter)
	return formatter
}

// biome-ignore lint/complexity/useMaxParams: Intl.NumberFormat options require locale and formatting parameters
const scalarFormatter = (
	unit: ScalarUnitId,
	locale: string,
	digits: number,
	unitDisplay: 'long' | 'narrow' | 'short'
): Intl.NumberFormat =>
	getNumberFormatter(locale, {
		maximumFractionDigits: digits,
		style: 'unit',
		unit: UNITS[unit].intlUnit,
		unitDisplay,
	})

/** Minimal shape formatting needs, so createEngine can format custom units alongside built-ins. */
export type FormattableUnit = {
	intlUnit: string | null
	shortLabel: LocalizedLabel
	longLabel?: LocalizedLabel
}

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
		const label = resolveLocalizedLabel(unit.shortLabel, locale)
		return `${getNumberFormatter(locale, { maximumFractionDigits: digits }).format(value)} ${label}`
	}
	return getNumberFormatter(locale, {
		maximumFractionDigits: digits,
		style: 'unit',
		unit: unit.intlUnit,
		unitDisplay,
	}).format(value)
}

const joinParts = (parts: string[], locale: string): string => {
	try {
		return getListFormatter(locale, 'narrow').format(parts)
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

/** Fallback label when intlUnit is null or extraction fails: longLabel if given, else shortLabel. */
const staticLabelFor = (unit: FormattableUnit, locale: string): string =>
	resolveLocalizedLabel(unit.longLabel ?? unit.shortLabel, locale)

/** intlUnit null means the unit has no ECMA-402 identifier: fall back to the resolved label. */
export const scalarLongLabelFor = (unit: FormattableUnit, locale: string): string => {
	if (unit.intlUnit === null) return staticLabelFor(unit, locale)
	const parts = getNumberFormatter(locale, {
		style: 'unit',
		unit: unit.intlUnit,
		unitDisplay: 'long',
	}).formatToParts(2)
	const unitPart = parts.find((part) => part.type === 'unit')
	return unitPart?.value ?? staticLabelFor(unit, locale)
}

/**
 * Same technique as scalarLongLabelFor but unitDisplay 'short': formatToParts(2) is only
 * used for extraction, the unit part alone is the label, nothing else is stripped from it.
 */
export const scalarShortLabelFor = (unit: FormattableUnit, locale: string): string => {
	if (unit.intlUnit === null) return resolveLocalizedLabel(unit.shortLabel, locale)
	const parts = getNumberFormatter(locale, {
		style: 'unit',
		unit: unit.intlUnit,
		unitDisplay: 'short',
	}).formatToParts(2)
	const unitPart = parts.find((part) => part.type === 'unit')
	return unitPart?.value ?? resolveLocalizedLabel(unit.shortLabel, locale)
}

const scalarLongLabel = (unit: ScalarUnitId, locale: string): string =>
	scalarLongLabelFor(UNITS[unit], locale)

const scalarShortLabel = (unit: ScalarUnitId, locale: string): string =>
	scalarShortLabelFor(UNITS[unit], locale)

/** Picker label for a unit. Both styles come from Intl so they localize for free. */
export const unitLabel = (unit: UnitId, locale: string, style: 'long' | 'short'): string => {
	if (isCompoundUnit(unit)) {
		const def = COMPOUNDS[unit]
		if (style === 'short')
			return `${scalarShortLabel(def.major, locale)} ${scalarShortLabel(def.minor, locale)}`
		const major = scalarLongLabel(def.major, locale)
		const minor = scalarLongLabel(def.minor, locale)
		try {
			return getListFormatter(locale, 'long').format([major, minor])
		} catch {
			return `${major} ${minor}`
		}
	}
	return style === 'short' ? scalarShortLabel(unit, locale) : scalarLongLabel(unit, locale)
}
