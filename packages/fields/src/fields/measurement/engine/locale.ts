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

/** Widened for lookup by any field dimension, including custom dimensions the table has no entry for. */
const dimensionLocaleDefaults: Partial<
	Record<string, Record<MeasurementSystem, MeasurementUnitId>>
> = DIMENSION_LOCALE_DEFAULTS

/** Locale step of the resolution chain: field-declared defaults first, then the per-dimension table. */
const localeCandidatesFor = (args: {
	dimension: string
	system: MeasurementSystem
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
}): MeasurementUnitId[] =>
	[
		args.localeDefaults?.[args.system],
		dimensionLocaleDefaults[args.dimension]?.[args.system],
	].filter((unit): unit is MeasurementUnitId => typeof unit === 'string')

/**
 * Display-unit resolution chain, in order: user preference, field fallback, plugin
 * registry default, then the locale steps (field locale defaults, then the per-dimension
 * table). First candidate the field actually offers wins; the field's first unit is the
 * floor. Pure and admin-free so both the client field and measurement-utils can use it.
 */
export const resolveDisplayUnit = (args: {
	dimension: string
	preferenceUnit?: MeasurementUnitId | null
	fallbackUnit?: MeasurementUnitId
	registryDefault?: MeasurementUnitId
	/** Null until the browser locale is read post-hydration, which skips both locale steps. */
	system?: MeasurementSystem | null
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
	units: readonly MeasurementUnitId[]
}): MeasurementUnitId => {
	const localeCandidates = args.system
		? localeCandidatesFor({
				dimension: args.dimension,
				localeDefaults: args.localeDefaults,
				system: args.system,
			})
		: []
	const candidates = [
		args.preferenceUnit,
		args.fallbackUnit,
		args.registryDefault,
		...localeCandidates,
	]
	for (const candidate of candidates) {
		if (candidate && args.units.includes(candidate)) return candidate
	}
	const first = args.units[0]
	if (!first) throw new Error('resolveDisplayUnit: empty units list')
	return first
}
