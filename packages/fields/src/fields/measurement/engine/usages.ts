import type { Dimension, ScalarUnitId, UnitId } from './units'

export type MeasurementUsage =
	| 'bodyWeight'
	| 'distance'
	| 'length'
	| 'mass'
	| 'personHeight'
	| 'speed'
	| 'temperature'
	| 'volume'

export type MeasurementSystem = 'metric' | 'uk' | 'us'

export type UsageDef = {
	dimension: Dimension
	units: UnitId[]
	defaultStorageUnit: ScalarUnitId
	defaultName: string
	defaults: Record<MeasurementSystem, UnitId>
}

export const USAGES: Record<MeasurementUsage, UsageDef> = {
	bodyWeight: {
		dimension: 'mass',
		units: ['kg', 'lb', 'st-lb'],
		defaultStorageUnit: 'kg',
		defaultName: 'weight',
		defaults: { metric: 'kg', us: 'lb', uk: 'st-lb' },
	},
	personHeight: {
		dimension: 'length',
		units: ['cm', 'm', 'in', 'ft-in'],
		defaultStorageUnit: 'cm',
		defaultName: 'height',
		defaults: { metric: 'cm', us: 'ft-in', uk: 'ft-in' },
	},
	distance: {
		dimension: 'length',
		units: ['m', 'km', 'mi'],
		defaultStorageUnit: 'km',
		defaultName: 'distance',
		defaults: { metric: 'km', us: 'mi', uk: 'mi' },
	},
	mass: {
		dimension: 'mass',
		units: ['g', 'kg', 'oz', 'lb'],
		defaultStorageUnit: 'kg',
		defaultName: 'mass',
		defaults: { metric: 'kg', us: 'lb', uk: 'lb' },
	},
	length: {
		dimension: 'length',
		units: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'],
		defaultStorageUnit: 'cm',
		defaultName: 'length',
		defaults: { metric: 'cm', us: 'in', uk: 'in' },
	},
	volume: {
		dimension: 'volume',
		units: ['ml', 'l', 'fl-oz', 'gal'],
		defaultStorageUnit: 'l',
		defaultName: 'volume',
		defaults: { metric: 'l', us: 'fl-oz', uk: 'l' },
	},
	temperature: {
		dimension: 'temperature',
		units: ['c', 'f'],
		defaultStorageUnit: 'c',
		defaultName: 'temperature',
		defaults: { metric: 'c', us: 'f', uk: 'c' },
	},
	speed: {
		dimension: 'speed',
		units: ['km/h', 'mph', 'm/s'],
		defaultStorageUnit: 'km/h',
		defaultName: 'speed',
		defaults: { metric: 'km/h', us: 'mph', uk: 'mph' },
	},
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

export const resolveUnitForLocale = (locale: string, usage: MeasurementUsage): UnitId =>
	USAGES[usage].defaults[systemForLocale(locale)]
