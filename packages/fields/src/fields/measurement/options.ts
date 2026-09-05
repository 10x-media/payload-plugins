import type { NumberField } from 'payload'
import type { MeasurementSystem } from './engine/locale'
import type { MeasurementCustomConfig } from './engine/registry'
import type { DimOf, MeasurementUnitId, ScalarUnitId, UnitOfDimension } from './engine/units'

/** payload-preferences key holding the flat per-bucket unit map. */
export const MEASUREMENT_PREFERENCE_KEY = '10x-fields-measurement'

/** Saved display units, keyed by each field's `preferenceKey`. */
export type MeasurementUnitsPreference = Partial<Record<string, MeasurementUnitId>>

type CommonFieldOptions<U extends string> = {
	name?: string
	label?: NumberField['label']
	required?: boolean
	localized?: boolean
	index?: boolean
	/** Bounds in the storage unit, enforced by Payload's native number validation. */
	min?: number
	max?: number
	/** Units offered in the unit picker. Defaults to every unit of the storage unit's dimension. */
	units?: readonly U[]
	/** Preference bucket shared with every field using the same key. Defaults to the dimension. */
	preferenceKey?: string
	/** Display fallback for users with no saved preference, ahead of the plugin and locale defaults. */
	fallbackUnit?: U
	/** Locale-system defaults for this field, ahead of the per-dimension table. */
	localeDefaults?: Partial<Record<MeasurementSystem, U>>
	/** Per-unit display fraction digits, overriding the engine defaults. */
	precision?: Partial<Record<U, number>>
	overrides?: (args: { field: NumberField }) => NumberField
}

/**
 * Built-in units only: `units`, `fallbackUnit`, `localeDefaults` and `precision`
 * keys narrow to the storage unit's dimension.
 */
export type MeasurementFieldOptions<S extends ScalarUnitId = ScalarUnitId> = CommonFieldOptions<
	UnitOfDimension<DimOf<S>>
> & {
	/** Unit the number is stored in. Match existing data to adopt with zero migration. */
	storageUnit: S
	custom?: undefined
}

/** Custom units in play: ids are plain strings, so runtime validation carries the narrowing. */
export type MeasurementCustomFieldOptions = CommonFieldOptions<string> & {
	storageUnit: string
	custom: MeasurementCustomConfig
}

export type AnyMeasurementFieldOptions = MeasurementCustomFieldOptions | MeasurementFieldOptions

/**
 * Serializable options shipped to both the Field and Cell components. Unit ids stay
 * widened here: the components rebuild the field's engine from `custom` and resolve
 * every id through it, so a custom id is as valid as a built-in one.
 */
export type MeasurementClientOptions = {
	storageUnit: MeasurementUnitId
	units: readonly MeasurementUnitId[]
	preferenceKey: string
	dimension: string
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
	fallbackUnit?: MeasurementUnitId
	precision?: Partial<Record<MeasurementUnitId, number>>
	custom?: MeasurementCustomConfig
}

/** What MeasurementFieldServer hands the client after per-request resolution. */
export type MeasurementResolvedClientOptions = MeasurementClientOptions & {
	/** The viewer's saved unit for this bucket, read server-side for a flash-free first paint. */
	initialUnit?: MeasurementUnitId
	/** Plugin-registry default for this bucket. */
	registryDefault?: MeasurementUnitId
}
