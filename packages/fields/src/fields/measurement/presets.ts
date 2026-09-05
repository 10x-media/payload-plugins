import type { ScalarUnitId, UnitId } from './engine/units'
import type { MeasurementSystem } from './engine/usages'

/** Spreadable bundle of measurementField options: storage, offered units, preference bucket, name. */
export type MeasurementPreset = {
	storageUnit: ScalarUnitId
	units: readonly UnitId[]
	/** Preference bucket every field spreading this preset shares. */
	preferenceKey: string
	name: string
	localeDefaults: Partial<Record<MeasurementSystem, UnitId>>
}

/**
 * Curated starting points, spread into measurementField() and overridden per field.
 * The preference keys are data: renaming one orphans every unit a user already saved.
 */
export const presets = {
	bodyWeight: {
		storageUnit: 'kg',
		units: ['kg', 'lb', 'st-lb'],
		preferenceKey: 'bodyWeight',
		name: 'weight',
		localeDefaults: { metric: 'kg', us: 'lb', uk: 'st-lb' },
	},
	personHeight: {
		storageUnit: 'cm',
		units: ['cm', 'm', 'in', 'ft-in'],
		preferenceKey: 'personHeight',
		name: 'height',
		localeDefaults: { metric: 'cm', us: 'ft-in', uk: 'ft-in' },
	},
	distance: {
		storageUnit: 'km',
		units: ['m', 'km', 'mi'],
		preferenceKey: 'distance',
		name: 'distance',
		localeDefaults: { metric: 'km', us: 'mi', uk: 'mi' },
	},
	mass: {
		storageUnit: 'kg',
		units: ['g', 'kg', 'oz', 'lb'],
		preferenceKey: 'mass',
		name: 'mass',
		localeDefaults: { metric: 'kg', us: 'lb', uk: 'lb' },
	},
	length: {
		storageUnit: 'cm',
		units: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'],
		preferenceKey: 'length',
		name: 'length',
		localeDefaults: { metric: 'cm', us: 'in', uk: 'in' },
	},
	volume: {
		storageUnit: 'l',
		units: ['ml', 'l', 'fl-oz', 'gal'],
		preferenceKey: 'volume',
		name: 'volume',
		localeDefaults: { metric: 'l', us: 'fl-oz', uk: 'l' },
	},
	temperature: {
		storageUnit: 'c',
		units: ['c', 'f'],
		preferenceKey: 'temperature',
		name: 'temperature',
		localeDefaults: { metric: 'c', us: 'f', uk: 'c' },
	},
	speed: {
		storageUnit: 'km/h',
		units: ['km/h', 'mph', 'm/s'],
		preferenceKey: 'speed',
		name: 'speed',
		localeDefaults: { metric: 'km/h', us: 'mph', uk: 'mph' },
	},
} as const satisfies Record<string, MeasurementPreset>

export type MeasurementUsage = keyof typeof presets
