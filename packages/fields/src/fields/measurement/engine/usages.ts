import type { CoreDimension, UnitId } from './units'

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
 * Locale step of the display-unit chain: the field's own defaults first, then the
 * per-dimension table. Null for a custom dimension the field gave no defaults for.
 */
export const localeDefaultUnit = (args: {
	dimension: string
	locale: string
	localeDefaults?: Partial<Record<MeasurementSystem, UnitId>>
}): UnitId | null => {
	const system = systemForLocale(args.locale)
	return args.localeDefaults?.[system] ?? BY_DIMENSION[args.dimension]?.[system] ?? null
}
