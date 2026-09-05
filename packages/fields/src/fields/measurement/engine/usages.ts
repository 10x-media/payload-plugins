import type { CoreDimension, MeasurementUnitId, UnitId } from './units'

export type MeasurementSystem = 'metric' | 'uk' | 'us'

/** Final fallback in the resolution chain: locale-system default per built-in dimension. */
export const DIMENSION_LOCALE_DEFAULTS: Record<CoreDimension, Record<MeasurementSystem, UnitId>> = {
	mass: { metric: 'kg', uk: 'lb', us: 'lb' },
	length: { metric: 'cm', uk: 'in', us: 'in' },
	volume: { metric: 'l', uk: 'l', us: 'fl-oz' },
	temperature: { metric: 'c', uk: 'c', us: 'f' },
	speed: { metric: 'km/h', uk: 'mph', us: 'mph' },
}

/**
 * CLDR supplemental measurementData, complete: world default metric, US system
 * for US and Liberia, UK system for Great Britain and Myanmar. No shipped Intl
 * API exposes this, so the five-entry table is vendored.
 */
const US_REGIONS = new Set(['US', 'LR'])
const UK_REGIONS = new Set(['GB', 'MM'])

export const systemForLocale = (locale: string): MeasurementSystem => {
	let region: string | undefined
	try {
		const parsed = new Intl.Locale(locale)
		region = parsed.region ?? parsed.maximize().region
	} catch {
		return 'metric'
	}
	if (region && US_REGIONS.has(region)) return 'us'
	if (region && UK_REGIONS.has(region)) return 'uk'
	return 'metric'
}

const BY_DIMENSION: Partial<Record<string, Record<MeasurementSystem, UnitId>>> =
	DIMENSION_LOCALE_DEFAULTS

/**
 * Locale steps of the display-unit chain, in order: the field's own defaults, then
 * the per-dimension table. Two candidates rather than one, so a field default the
 * field no longer offers falls through to the table instead of ending the chain.
 */
export const localeDefaultUnits = (args: {
	dimension: string
	system: MeasurementSystem
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
}): MeasurementUnitId[] =>
	[args.localeDefaults?.[args.system], BY_DIMENSION[args.dimension]?.[args.system]].filter(
		(unit): unit is MeasurementUnitId => typeof unit === 'string'
	)

/** Locale step of the display-unit chain. Null for a custom dimension the field gave no defaults for. */
export const localeDefaultUnit = (args: {
	dimension: string
	locale: string
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
}): MeasurementUnitId | null =>
	localeDefaultUnits({
		dimension: args.dimension,
		localeDefaults: args.localeDefaults,
		system: systemForLocale(args.locale),
	})[0] ?? null
